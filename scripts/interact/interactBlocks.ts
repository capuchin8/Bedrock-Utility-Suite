import { system, world, type Player } from "@minecraft/server";
import { t, tell } from "../core/lang";
import { isOwner } from "../permissions/permissionStore";
import { runAsPlayer } from "../events/eventCommands";
import { showRules } from "../rules/rulesPrompt";
import { blockKey, getBlock, removeBlock, saveBlock, type BlockAction } from "./interactStore";

// What an owner has "armed": the next block they right-click is linked (or unlinked).
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

    const arm = armed.get(player.id);
    if (arm && arm.expires >= system.currentTick) {
        event.cancel = true;
        armed.delete(player.id);
        system.run(() => applyArmed(player, arm.what, key, type));
        return;
    }
    if (arm) armed.delete(player.id); // expired

    const action = getBlock(key);
    if (!action) return;
    event.cancel = true;
    if (action.type !== type) {
        // The linked block was replaced or removed: drop the stale link and let the click through next time.
        system.run(() => removeBlock(key));
        return;
    }
    const now = system.currentTick;
    if (now - (lastUse.get(player.id) ?? -COOLDOWN_TICKS) < COOLDOWN_TICKS) return;
    lastUse.set(player.id, now);
    system.run(() => trigger(player, action));
});

function applyArmed(player: Player, what: Armed, key: string, type: string): void {
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

