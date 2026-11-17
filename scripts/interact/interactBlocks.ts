import { Player, system, world, type Entity, type Vector3 } from "@minecraft/server";
import { t, tell } from "../core/lang";
import { isOwner } from "../permissions/permissionStore";
import { runAsPlayer } from "../events/eventCommands";
import { showRules } from "../rules/rulesPrompt";
import { clearEntityAction, getEntityAction, setEntityAction } from "./entityLinks";
import { blockKey, getBlock, removeBlock, saveBlock, type BlockAction } from "./interactStore";
import { claimBlockTreasure, claimEntityTreasure, ensureBreakGuard } from "./treasure";
import {
  getBlockTreasure,
  getEntityTreasure,
  newTreasure,
  removeBlockTreasure,
  clearEntityTreasure,
  saveBlockTreasure,
  setEntityTreasure,
} from "./treasureStore";

// What an owner has "armed": the next block OR entity they right-click is linked (or unlinked).
// "treasure" turns a container into a treasure (see treasure.ts).
type Armed = { mode: "bind"; action: Omit<BlockAction, "type"> } | { mode: "remove" } | { mode: "treasure" };

const ARM_TICKS = 1200; // 60 seconds
const COOLDOWN_TICKS = 10;

const armed = new Map<string, { what: Armed; expires: number }>();
const lastUse = new Map<string, number>();

export function armPlayer(player: Player, what: Armed): void {
  armed.set(player.id, { what, expires: system.currentTick + ARM_TICKS });
}

export function disarmPlayer(player: Player): void {
  armed.delete(player.id);
}

/** The armed action if it is still valid (an expired one is dropped). Takes it: it can only be used once. */
function takeArmed(player: Player): Armed | undefined {
  const arm = armed.get(player.id);
  if (!arm) return undefined;
  armed.delete(player.id);
  return arm.expires >= system.currentTick ? arm.what : undefined;
}

/** true = let this click through this time (still on cooldown from the last one). */
function onCooldown(player: Player): boolean {
  const now = system.currentTick;
  if (now - (lastUse.get(player.id) ?? -COOLDOWN_TICKS) < COOLDOWN_TICKS) return true;
  lastUse.set(player.id, now);
  return false;
}

// ---- blocks ----------------------------------------------------------------------------------
// Before-event so the click can be cancelled (no sign editor, no book, no block placed against it).
// Restricted-execution: only read and cancel here, everything else is deferred.
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  if (!event.isFirstEvent) {
    // Held-down repeats: keep swallowing them for linked blocks so nothing opens late.
    const repeatKey = blockKey(event.block.dimension.id, event.block.location);
    if (getBlock(repeatKey) || (getBlockTreasure(repeatKey) && !opensForEditing(event.player))) event.cancel = true;
    return;
  }
  const { player, block } = event;
  const key = blockKey(block.dimension.id, block.location);
  const type = block.typeId;
  const dimensionId = block.dimension.id;
  const location = block.location;

  const what = takeArmed(player);
  if (what) {
    event.cancel = true;
    system.run(() => applyArmedToBlock(player, what, key, type, dimensionId, location));
    return;
  }

  // Treasure container: nobody opens it, they claim what is inside.
  const treasure = getBlockTreasure(key);
  if (treasure) {
    if (treasure.type !== type) {
      // The container was replaced: drop the stale treasure and let this click through.
      system.run(() => removeBlockTreasure(key));
    } else if (!opensForEditing(player)) {
      event.cancel = true;
      if (!onCooldown(player)) system.run(() => claimBlockTreasure(player, dimensionId, location));
    }
    return;
  }

  const action = getBlock(key);
  if (!action) return;
  event.cancel = true;
  if (action.type !== type) {
    // The linked block was replaced or removed: drop the stale link and let the click through next time.
    system.run(() => removeBlock(key));
    return;
  }
  if (onCooldown(player)) return;
  system.run(() => trigger(player, action));
});

// ---- entities --------------------------------------------------------------------------------
// Cancelling this stops whatever the entity would normally do (trade screen, inventory, mounting,
// dialogue...). The link lives on the entity itself (see entityLinks.ts).
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  const { player, target } = event;
  if (target instanceof Player) return; // players can't be linked

  const what = takeArmed(player);
  if (what) {
    event.cancel = true;
    system.run(() => applyArmedToEntity(player, what, target));
    return;
  }

  if (getEntityTreasure(target)) {
    if (opensForEditing(player)) return;
    event.cancel = true;
    if (!onCooldown(player)) system.run(() => claimEntityTreasure(player, target));
    return;
  }

  const action = getEntityAction(target);
  if (!action) return;
  event.cancel = true;
  if (onCooldown(player)) return;
  system.run(() => trigger(player, action));
});

/** An owner who is sneaking opens a treasure container normally, so its contents can be changed. */
function opensForEditing(player: Player): boolean {
  return player.isSneaking && isOwner(player);
}

// ---- applying ---------------------------------------------------------------------------------
function applyArmedToBlock(
  player: Player,
  what: Armed,
  key: string,
  type: string,
  dimensionId: string,
  location: Vector3
): void {
  if (!player.isValid) return;
  // Re-check at the moment of applying: this feature runs commands, so it stays owner-only.
  if (!isOwner(player)) {
    tell(player, t("bus.interact.access_revoked"));
    return;
  }
  if (what.mode === "remove") {
    if (getBlock(key)) {
      removeBlock(key);
      tell(player, t("bus.interact.removed"));
    } else if (getBlockTreasure(key)) {
      removeBlockTreasure(key);
      tell(player, t("bus.treasure.removed"));
    } else {
      tell(player, t("bus.interact.not_linked"));
    }
    return;
  }
  if (what.mode === "treasure") {
    if (getBlockTreasure(key)) return tell(player, t("bus.treasure.error.exists"));
    if (getBlock(key)) return tell(player, t("bus.treasure.error.linked"));
    let hasInventory = false;
    try {
      hasInventory = !!world.getDimension(dimensionId).getBlock(location)?.getComponent("minecraft:inventory")
        ?.container;
    } catch {
      // not loaded
    }
    if (!hasInventory) return tell(player, t("bus.treasure.error.no_container"));
    if (!saveBlockTreasure(key, newTreasure(type))) return tell(player, t("bus.treasure.error.full"));
    ensureBreakGuard();
    tell(player, t("bus.treasure.created"));
    return;
  }
  if (getBlockTreasure(key)) return tell(player, t("bus.treasure.error.is_treasure"));
  if (saveBlock(key, { ...what.action, type })) tell(player, t("bus.interact.linked"));
  else tell(player, t("bus.interact.error.full"));
}

function applyArmedToEntity(player: Player, what: Armed, target: Entity): void {
  if (!player.isValid) return;
  if (!isOwner(player)) {
    tell(player, t("bus.interact.access_revoked"));
    return;
  }
  if (!target.isValid) {
    tell(player, t("bus.interact.error.entity_gone"));
    return;
  }
  if (what.mode === "remove") {
    if (getEntityAction(target)) {
      clearEntityAction(target);
      tell(player, t("bus.interact.removed"));
    } else if (getEntityTreasure(target)) {
      clearEntityTreasure(target);
      tell(player, t("bus.treasure.removed"));
    } else {
      tell(player, t("bus.interact.not_linked"));
    }
    return;
  }
  if (what.mode === "treasure") {
    if (getEntityTreasure(target)) return tell(player, t("bus.treasure.error.exists"));
    if (getEntityAction(target)) return tell(player, t("bus.treasure.error.linked"));
    if (!target.getComponent("minecraft:inventory")?.container)
      return tell(player, t("bus.treasure.error.no_container"));
    if (!setEntityTreasure(target, newTreasure(target.typeId))) return tell(player, t("bus.treasure.error.full"));
    tell(player, t("bus.treasure.created"));
    return;
  }
  if (getEntityTreasure(target)) return tell(player, t("bus.treasure.error.is_treasure"));
  if (setEntityAction(target, what.action)) tell(player, t("bus.interact.linked"));
  else tell(player, t("bus.interact.error.full"));
}

function trigger(player: Player, action: BlockAction): void {
  if (!player.isValid) return;
  if (action.rules) showRules(player, { readOnly: true });
  if (action.commands.length > 0) runAsPlayer(player, action.commands);
}

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  armed.delete(playerId);
  lastUse.delete(playerId);
});

// Block broken by a player: drop the link right away (explosions etc. are caught lazily on next click).
world.afterEvents.playerBreakBlock.subscribe(({ block, dimension }) => {
  const key = blockKey(dimension.id, block.location);
  if (getBlock(key)) removeBlock(key);
  if (getBlockTreasure(key)) removeBlockTreasure(key); // only reached when protection is off
});
