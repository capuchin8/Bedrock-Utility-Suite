import { EquipmentSlot, Player, world, type Entity, type ItemStack } from "@minecraft/server";
import { isGod, setGod } from "./godMode";

// Shared "hide / restore a player's whole inventory" service. /bus:inventory uses it, and so can any
// other module (minigames, kits, moderation tools) without going through the command:
//   import { hideInventory, restoreInventory, isInventoryHidden } from "../inventory/inventoryVault";
//   const result = hideInventory(player);          // { ok: true } or { ok: false, error }
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

export type VaultError = "already_hidden" | "not_hidden" | "hide_failed" | "restore_missing" | "restore_failed";
export type VaultResult = { ok: true } | { ok: false; error: VaultError };

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

function readCursorItem(player: Player): ItemStack | undefined {
  try {
    return player.getComponent("minecraft:cursor_inventory")?.item;
  } catch {
    return undefined;
  }
}

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
    storage = dimension.spawnEntity(STORAGE_ENTITY_ID, {
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

  // Copy first and clear the player afterwards: if anything throws here, nothing has left the player.
  const cursorItem = readCursorItem(player);
  try {
    storage.addEffect("invisibility", 20000000, { showParticles: false, amplifier: 0 });

    for (let i = 0; i < playerContainer.size; i++) {
      const item = playerContainer.getItem(i);
      if (item) storageContainer.setItem(i, item);
    }
    for (const slot of VAULT_ARMOR_SLOTS) {
      const item = equippable.getEquipment(slot);
      if (item) storageContainer.setItem(ARMOR_STORAGE_SLOT[slot], item);
    }
    if (cursorItem && CURSOR_STORAGE_SLOT < storageContainer.size) {
      storageContainer.setItem(CURSOR_STORAGE_SLOT, cursorItem);
    }
  } catch (e) {
    console.warn(`[bus:inventory] could not copy ${player.name}'s items: ${e}`);
    storage.remove();
    return { ok: false, error: "hide_failed" };
  }

  protect(storage);

  for (const slot of VAULT_ARMOR_SLOTS) equippable.setEquipment(slot, undefined);
  playerContainer.clearAll();
  if (cursorItem) {
    try {
      player.getComponent("minecraft:cursor_inventory")?.clear();
    } catch (e) {
      console.warn(`[bus:inventory] could not clear ${player.name}'s cursor item: ${e}`);
    }
  }

  player.setDynamicProperty(STORAGE_ENTITY_KEY_ID, storage.id);
  player.setDynamicProperty(SELECTED_SLOT_KEY, player.selectedSlotIndex);
  player.setDynamicProperty(HIDDEN_FLAG_KEY, true);
  notify(player, true);
  return { ok: true };
}

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

  playerContainer.clearAll();
  for (let i = 0; i < playerContainer.size; i++) {
    const item = storageContainer.getItem(i);
    if (item) playerContainer.setItem(i, item);
  }
  for (const slot of VAULT_ARMOR_SLOTS) {
    equippable.setEquipment(slot, storageContainer.getItem(ARMOR_STORAGE_SLOT[slot]));
  }

  // The API can't put an item back on the cursor, so it goes to the first free slot (or drops at the
  // player's feet if the inventory is full). Storage entities made before the cursor slot existed are
  // smaller, hence the size check.
  if (CURSOR_STORAGE_SLOT < storageContainer.size) {
    const cursorItem = storageContainer.getItem(CURSOR_STORAGE_SLOT);
    if (cursorItem) {
      try {
        const leftover = playerContainer.addItem(cursorItem);
        if (leftover) player.dimension.spawnItem(leftover, player.location);
      } catch (e) {
        console.warn(`[bus:inventory] could not return ${player.name}'s cursor item: ${e}`);
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
  return { ok: true };
}
