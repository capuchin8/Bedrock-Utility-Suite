import { Player, system, world, type Entity } from "@minecraft/server";
import { t, tell } from "../core/lang";
import { isOwner } from "../permissions/permissionStore";
import { runAsPlayer } from "../events/eventCommands";
import { showRules } from "../rules/rulesPrompt";
import { clearEntityAction, getEntityAction, setEntityAction } from "./entityLinks";
import { blockKey, getBlock, removeBlock, saveBlock, type BlockAction } from "./interactStore";

// What an owner has "armed": the next block OR entity they right-click is linked (or unlinked).
type Armed = { mode: "bind"; action: Omit<BlockAction, "type"> } | { mode: "remove" };

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
    if (getBlock(blockKey(event.block.dimension.id, event.block.location))) event.cancel = true;
    return;
  }
  const { player, block } = event;
  const key = blockKey(block.dimension.id, block.location);
  const type = block.typeId;

  const what = takeArmed(player);
  if (what) {
    event.cancel = true;
    system.run(() => applyArmedToBlock(player, what, key, type));
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

  const action = getEntityAction(target);
  if (!action) return;
  event.cancel = true;
  if (onCooldown(player)) return;
  system.run(() => trigger(player, action));
});

// ---- applying ---------------------------------------------------------------------------------
function applyArmedToBlock(player: Player, what: Armed, key: string, type: string): void {
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
    } else {
      tell(player, t("bus.interact.not_linked"));
    }
    return;
  }
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
    } else {
      tell(player, t("bus.interact.not_linked"));
    }
    return;
  }
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
});
