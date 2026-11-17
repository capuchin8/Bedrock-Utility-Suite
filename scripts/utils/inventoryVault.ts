import {
  EquipmentSlot,
  Player,
  world,
  type Container,
  type Entity,
  type EntityEquippableComponent,
  type ItemStack,
} from "@minecraft/server";
import { isGod, setGod } from "./godMode";

// Shared "hide / restore a player's whole inventory" service. /bus:inventory uses it, and so can any
// other module (minigames, kits, moderation tools) without going through the command:
//   import { hideInventory, restoreInventory, isInventoryHidden } from "../inventory/inventoryVault";
//   const result = hideInventory(player);          // { ok: true, relocated } or { ok: false, error }
//
// Both functions mutate the world (they spawn/remove an entity and move items), so call them outside
// restricted execution: wrap them in system.run when you are in a before-event or command callback.
//
// How it works: the real ItemStack objects are moved into a hidden storage entity instead of being
// serialized, so everything the engine tracks on an item (armor trims included) survives. The storage
// entity is in god mode while it holds items and is removed as soon as the inventory is restored.
// Restoring clears whatever the player is carrying at that moment first, so anything they picked up
// while hidden is replaced by the hidden items.
//
// Verification: every move is read back and compared to what was there before (type, amount, name,
// lore, durability, enchantments, dynamic property ids). Armor trims have no script API, so they can't
// be compared, but they ride along because the original object is what gets moved.
//   - hide: the player is only cleared after the storage copy checks out, and the clear itself is
//     checked. If anything can't be verified the hide is rolled back and nothing is lost.
//   - restore: each slot is checked after it is written, retried once, and an item that still won't go
//     into its own slot is placed in any free slot (or dropped at the player's feet) instead of being
//     lost. The storage entity is only removed once everything is accounted for.
//
// REQUIRES behavior_packs/Bedrock Utility Suite/entities/inventory_storage.json (bus:inventory_storage).

const STORAGE_ENTITY_ID = "bus:inventory_storage";
const STORAGE_ENTITY_KEY_ID = "bus:storage_entity_id"; // dynamic prop on player: string entity id
const HIDDEN_FLAG_KEY = "bus:is_hidden"; // dynamic prop on player: boolean
const SELECTED_SLOT_KEY = "bus:selected_slot"; // dynamic prop on player: number

export const VAULT_ARMOR_SLOTS: EquipmentSlot[] = [
  EquipmentSlot.Head,
  EquipmentSlot.Chest,
  EquipmentSlot.Legs,
  EquipmentSlot.Feet,
  EquipmentSlot.Offhand,
];

// Storage entity container layout: slots 0-35 mirror the player's main inventory 1:1,
// 36-40 hold armor + offhand, 41 holds the item on the player's cursor.
const ARMOR_STORAGE_SLOT: Record<string, number> = {
  [EquipmentSlot.Head]: 36,
  [EquipmentSlot.Chest]: 37,
  [EquipmentSlot.Legs]: 38,
  [EquipmentSlot.Feet]: 39,
  [EquipmentSlot.Offhand]: 40,
};
const CURSOR_STORAGE_SLOT = 41;

export type VaultError =
  | "already_hidden"
  | "not_hidden"
  | "hide_failed"
  | "hide_unverified"
  | "restore_missing"
  | "restore_failed"
  | "restore_unverified";
/** relocated = items that could not go back into their own slot and were placed elsewhere instead. */
export type VaultResult = { ok: true; relocated: number } | { ok: false; error: VaultError };

export type VaultListener = (player: Player, hidden: boolean) => void;
const listeners: VaultListener[] = [];

/** Runs after a player's inventory was hidden (hidden = true) or restored (hidden = false). */
export function onInventoryVaultChanged(listener: VaultListener): void {
  listeners.push(listener);
}

function notify(player: Player, hidden: boolean): void {
  for (const listener of listeners) {
    try {
      listener(player, hidden);
    } catch (e) {
      console.warn(`[bus:inventory] listener failed: ${e}`);
    }
  }
}

export function isInventoryHidden(player: Player): boolean {
  return player.getDynamicProperty(HIDDEN_FLAG_KEY) === true;
}

// ---- slots and verification -----------------------------------------------------------------------

interface VaultSlot {
  /** Slot in the storage entity's container. */
  storage: number;
  label: string;
  get: () => ItemStack | undefined;
  set: (item: ItemStack | undefined) => void;
}

interface Snapshot {
  slot: VaultSlot;
  item: ItemStack | undefined;
}

/** The player's main inventory slots and armor/offhand, as uniform get/set pairs. */
function buildSlots(container: Container, equippable: EntityEquippableComponent): VaultSlot[] {
  const slots: VaultSlot[] = [];
  for (let i = 0; i < container.size; i++) {
    slots.push({
      storage: i,
      label: `slot ${i}`,
      get: () => container.getItem(i),
      set: (item) => container.setItem(i, item),
    });
  }
  for (const equipment of VAULT_ARMOR_SLOTS) {
    slots.push({
      storage: ARMOR_STORAGE_SLOT[equipment],
      label: String(equipment),
      get: () => equippable.getEquipment(equipment),
      set: (item) => equippable.setEquipment(equipment, item),
    });
  }
  return slots;
}

function readCursorItem(player: Player): ItemStack | undefined {
  try {
    return player.getComponent("minecraft:cursor_inventory")?.item;
  } catch {
    return undefined;
  }
}

/** A comparable summary of an item. Empty string = no item. */
function fingerprint(item: ItemStack | undefined): string {
  if (!item) return "";
  try {
    const parts = [item.typeId, String(item.amount), item.nameTag ?? "", item.getLore().join("\n")];
    const durability = item.getComponent("minecraft:durability");
    if (durability) parts.push(`d${durability.damage}`);
    const enchants = item.getComponent("minecraft:enchantable")?.getEnchantments() ?? [];
    parts.push(
      enchants
        .map((e) => `${e.type.id}:${e.level}`)
        .sort()
        .join(",")
    );
    parts.push(item.getDynamicPropertyIds().sort().join(","));
    return parts.join("|");
  } catch (e) {
    // An unreadable item can't be proven equal; fall back to the basics so it isn't a false alarm.
    console.warn(`[bus:inventory] could not fingerprint ${item.typeId}: ${e}`);
    return `${item.typeId}|${item.amount}`;
  }
}

function safeGet(get: () => ItemStack | undefined): ItemStack | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}

/** Describes an item for the log, so a failure says exactly what went wrong. */
function describe(item: ItemStack | undefined): string {
  return item ? `${item.typeId} x${item.amount}` : "(empty)";
}

/** Entries whose target (read through `read`) doesn't match the original item. */
function mismatches(snapshot: Snapshot[], read: (slot: VaultSlot) => ItemStack | undefined): Snapshot[] {
  return snapshot.filter(({ slot, item }) => fingerprint(item) !== fingerprint(read(slot)));
}

function logMismatches(
  what: string,
  player: Player,
  list: Snapshot[],
  read: (slot: VaultSlot) => ItemStack | undefined
) {
  for (const { slot, item } of list) {
    console.warn(
      `[bus:inventory] ${what} for ${player.name}: ${slot.label} expected ${describe(item)}, found ${describe(read(slot))}`
    );
  }
}

/** Puts the storage entity in god mode. A failure is logged but never blocks the hide. */
function protect(entity: Entity): void {
  try {
    if (!isGod(entity)) setGod(entity, true);
  } catch (e) {
    console.warn(`[bus:inventory] could not protect the storage entity: ${e}`);
  }
}

function release(entity: Entity): void {
  try {
    if (isGod(entity)) setGod(entity, false);
  } catch (e) {
    console.warn(`[bus:inventory] could not release the storage entity: ${e}`);
  }
}

// ---- hide -----------------------------------------------------------------------------------------

/** Hides the player's inventory, armor, offhand and cursor item in a protected storage entity. */
export function hideInventory(player: Player): VaultResult {
  if (isInventoryHidden(player)) return { ok: false, error: "already_hidden" };

  const playerContainer = player.getComponent("minecraft:inventory")?.container;
  const equippable = player.getComponent("minecraft:equippable");
  if (!playerContainer || !equippable) return { ok: false, error: "hide_failed" };

  // Same X/Z as the player (their chunk is loaded), just below the build ceiling.
  const dimension = player.dimension;
  let storage: Entity;
  try {
    storage = dimension.spawnEntity(STORAGE_ENTITY_ID as Parameters<typeof dimension.spawnEntity>[0], {
      x: player.location.x,
      y: dimension.heightRange.max - 5,
      z: player.location.z,
    });
  } catch (e) {
    console.warn(`[bus:inventory] could not spawn the storage entity: ${e}`);
    return { ok: false, error: "hide_failed" };
  }

  const storageContainer = storage.getComponent("minecraft:inventory")?.container;
  if (!storageContainer) {
    storage.remove();
    return { ok: false, error: "hide_failed" };
  }

  const playerSlots = buildSlots(playerContainer, equippable);
  // Old storage entities (and a pack that wasn't reloaded) may not have the cursor slot.
  const sources: VaultSlot[] = [...playerSlots];
  if (CURSOR_STORAGE_SLOT < storageContainer.size) {
    sources.push({
      storage: CURSOR_STORAGE_SLOT,
      label: "cursor",
      get: () => readCursorItem(player),
      set: () => {}, // the API can't put an item on the cursor
    });
  }
  const snapshot: Snapshot[] = sources.map((slot) => ({ slot, item: safeGet(slot.get) }));
  const readStorage = (slot: VaultSlot) => safeGet(() => storageContainer.getItem(slot.storage));

  // 1. Copy into storage and verify. The player still has everything until this passes.
  try {
    storage.addEffect("invisibility", 20000000, { showParticles: false, amplifier: 0 });
  } catch (e) {
    console.warn(`[bus:inventory] could not make the storage entity invisible: ${e}`);
  }
  let pending = snapshot;
  for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
    for (const { slot, item } of pending) {
      if (!item) continue;
      try {
        storageContainer.setItem(slot.storage, item);
      } catch (e) {
        console.warn(`[bus:inventory] could not copy ${slot.label} for ${player.name}: ${e}`);
      }
    }
    pending = mismatches(snapshot, readStorage);
  }
  if (pending.length > 0) {
    logMismatches("hide copy not verified", player, pending, readStorage);
    storage.remove();
    return { ok: false, error: "hide_unverified" };
  }

  protect(storage);

  // 2. Clear the player and verify that it really is empty, otherwise items would exist twice.
  const clearPlayer = (): void => {
    for (const equipment of VAULT_ARMOR_SLOTS) {
      try {
        equippable.setEquipment(equipment, undefined);
      } catch (e) {
        console.warn(`[bus:inventory] could not clear ${equipment} for ${player.name}: ${e}`);
      }
    }
    try {
      playerContainer.clearAll();
    } catch (e) {
      console.warn(`[bus:inventory] could not clear the inventory of ${player.name}: ${e}`);
    }
    if (snapshot.some(({ slot, item }) => slot.label === "cursor" && item)) {
      try {
        player.getComponent("minecraft:cursor_inventory")?.clear();
      } catch (e) {
        console.warn(`[bus:inventory] could not clear ${player.name}'s cursor item: ${e}`);
      }
    }
  };
  const stillHolding = (): Snapshot[] => snapshot.filter(({ slot, item }) => item && safeGet(slot.get));

  clearPlayer();
  if (stillHolding().length > 0) clearPlayer();
  const leftover = stillHolding();
  if (leftover.length > 0) {
    // Roll back: put every item back where it was and drop the storage entity. Nothing is lost.
    console.warn(
      `[bus:inventory] hide not verified for ${player.name}: could not clear ${leftover.map((l) => l.slot.label).join(", ")}; rolled back`
    );
    for (const { slot, item } of snapshot) {
      if (!item || slot.label === "cursor") continue;
      try {
        slot.set(item);
      } catch (e) {
        console.warn(`[bus:inventory] rollback of ${slot.label} failed for ${player.name}: ${e}`);
      }
    }
    release(storage);
    storage.remove();
    return { ok: false, error: "hide_unverified" };
  }

  player.setDynamicProperty(STORAGE_ENTITY_KEY_ID, storage.id);
  player.setDynamicProperty(SELECTED_SLOT_KEY, player.selectedSlotIndex);
  player.setDynamicProperty(HIDDEN_FLAG_KEY, true);
  notify(player, true);
  return { ok: true, relocated: 0 };
}

// ---- restore --------------------------------------------------------------------------------------

/** Puts everything back exactly as it was and removes the storage entity. */
export function restoreInventory(player: Player): VaultResult {
  if (!isInventoryHidden(player)) return { ok: false, error: "not_hidden" };

  const storageId = player.getDynamicProperty(STORAGE_ENTITY_KEY_ID);
  const storage = typeof storageId === "string" ? world.getEntity(storageId) : undefined;
  if (!storage?.isValid) return { ok: false, error: "restore_missing" };

  const storageContainer = storage.getComponent("minecraft:inventory")?.container;
  const playerContainer = player.getComponent("minecraft:inventory")?.container;
  const equippable = player.getComponent("minecraft:equippable");
  if (!storageContainer || !playerContainer || !equippable) return { ok: false, error: "restore_failed" };

  // Everything is read from storage first; the storage entity stays untouched until the end, so a
  // failed or partial restore can simply be run again.
  const slots = buildSlots(playerContainer, equippable);
  const snapshot: Snapshot[] = slots.map((slot) => ({
    slot,
    item: safeGet(() => storageContainer.getItem(slot.storage)),
  }));
  const readPlayer = (slot: VaultSlot) => safeGet(slot.get);

  playerContainer.clearAll();

  // 1. Write every slot and verify, retrying the ones that didn't take once.
  let pending = snapshot;
  for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
    for (const { slot, item } of pending) {
      try {
        slot.set(item);
      } catch (e) {
        console.warn(`[bus:inventory] could not restore ${slot.label} for ${player.name}: ${e}`);
      }
    }
    pending = mismatches(snapshot, readPlayer);
  }

  // 2. Anything that still isn't right. An empty slot means the write didn't take: the item goes into
  // any free slot instead (or drops at the player's feet), so it is never lost. A slot that holds
  // something else is left alone and the restore is reported as unverified, with storage kept.
  let relocated = 0;
  let unresolved = 0;
  for (const { slot, item } of pending) {
    if (!item) {
      unresolved++; // slot should be empty but holds something
      continue;
    }
    if (readPlayer(slot)) {
      unresolved++;
      continue;
    }
    try {
      const overflow = playerContainer.addItem(item);
      if (overflow) player.dimension.spawnItem(overflow, player.location);
      relocated++;
      console.warn(
        `[bus:inventory] ${slot.label} would not take ${describe(item)} for ${player.name}; placed elsewhere`
      );
    } catch (e) {
      unresolved++;
      console.warn(`[bus:inventory] could not relocate ${describe(item)} for ${player.name}: ${e}`);
    }
  }
  if (unresolved > 0) {
    logMismatches("restore not verified", player, pending, readPlayer);
    return { ok: false, error: "restore_unverified" };
  }

  // 3. The cursor item can't go back on the cursor, so it goes to the first free slot (or drops at
  // the player's feet if the inventory is full). Storage entities made before the cursor slot existed
  // are smaller, hence the size check.
  if (CURSOR_STORAGE_SLOT < storageContainer.size) {
    const cursorItem = safeGet(() => storageContainer.getItem(CURSOR_STORAGE_SLOT));
    if (cursorItem) {
      try {
        const overflow = playerContainer.addItem(cursorItem);
        if (overflow) player.dimension.spawnItem(overflow, player.location);
      } catch (e) {
        console.warn(`[bus:inventory] could not return ${player.name}'s cursor item: ${e}`);
        return { ok: false, error: "restore_unverified" };
      }
    }
  }

  const selectedSlot = player.getDynamicProperty(SELECTED_SLOT_KEY);
  if (typeof selectedSlot === "number") player.selectedSlotIndex = selectedSlot;

  // Release god mode first so the module's list of protected ids doesn't fill up with deleted
  // entities, then remove the entity: it is no longer needed.
  release(storage);
  storage.remove();

  player.setDynamicProperty(STORAGE_ENTITY_KEY_ID, undefined);
  player.setDynamicProperty(SELECTED_SLOT_KEY, undefined);
  player.setDynamicProperty(HIDDEN_FLAG_KEY, false);
  notify(player, false);
  return { ok: true, relocated };
}
