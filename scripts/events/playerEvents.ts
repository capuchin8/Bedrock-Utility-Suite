import { system, world, type Player } from "@minecraft/server";

// One place that listens for players joining and leaving, so every module that cares (join/leave
// messages, first-join role, commands on join, the rules screen...) subscribes here instead of each
// keeping its own copy of the "is this their first time?" logic. Event-driven, no polling.

const SEEN_KEY = "bus:seen";

export type JoinListener = (player: Player, firstJoin: boolean) => void;
/** Runs in a before-event: read what you need NOW and defer any change with system.run. */
export type LeaveListener = (player: Player) => void;

const joinListeners: JoinListener[] = [];
const leaveListeners: LeaveListener[] = [];

export function onPlayerJoin(listener: JoinListener): void {
    joinListeners.push(listener);
}
export function onPlayerLeave(listener: LeaveListener): void {
    leaveListeners.push(listener);
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) return; // respawns and dimension changes aren't joins
    const firstJoin = player.getDynamicProperty(SEEN_KEY) !== true;
    for (const listener of joinListeners) {
        try {
            listener(player, firstJoin);
        } catch (e) {
            console.warn(`[bus:events] join listener failed: ${e}`);
        }
    }
    if (firstJoin) player.setDynamicProperty(SEEN_KEY, true);
});

world.beforeEvents.playerLeave.subscribe(({ player }) => {
    for (const listener of leaveListeners) {
        try {
            listener(player);
        } catch (e) {
            console.warn(`[bus:events] leave listener failed: ${e}`);
        }
    }
});

/** Defer a mutation out of a restricted-execution context. */
export const later = (fn: () => void): void => {
    system.run(fn);
};
