import { world, type Player } from "@minecraft/server";
import { t } from "../core/lang";
import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";
import { registerShareable } from "../share/shareRegistry";
import { later, onPlayerJoin, onPlayerLeave } from "./playerEvents";

const KEY = "bus:event_commands";
export const MAX_EVENT_COMMANDS = 20;

export type EventTrigger = "firstJoin" | "join" | "leave";

export interface EventCommands {
    /** Run the first time a player ever joins. */
    firstJoin: string[];
    /** Run every time a player joins. */
    join: string[];
    /** true = the "join" commands are skipped on a player's first join (only "firstJoin" runs). */
    joinExcludesFirst: boolean;
    /** Run when a player leaves. */
    leave: string[];
}

export const DEFAULT_EVENT_COMMANDS: EventCommands = { firstJoin: [], join: [], joinExcludesFirst: true, leave: [] };

function list(x: unknown): string[] {
    return Array.isArray(x)
        ? x.filter((c): c is string => typeof c === "string").slice(0, MAX_EVENT_COMMANDS).map((c) => c.slice(0, 256))
        : [];
}

export function normalizeEventCommands(v: unknown): EventCommands | undefined {
    if (!isRecord(v)) return undefined;
    return {
        firstJoin: list(v.firstJoin),
        join: list(v.join),
        joinExcludesFirst: typeof v.joinExcludesFirst === "boolean" ? v.joinExcludesFirst : true,
        leave: list(v.leave),
    };
}

export function getEventCommands(): EventCommands {
    return normalizeEventCommands(readWorldJson<unknown>(KEY, {})) ?? DEFAULT_EVENT_COMMANDS;
}

export function saveEventCommands(next: EventCommands): void {
    const clean = normalizeEventCommands(next);
    if (clean) writeWorldJson(KEY, clean);
}

/** Substitutes {player} with the quoted player name, and drops a leading "/". */
function prepare(command: string, playerName: string): string {
    const quoted = `"${playerName.replace(/"/g, "")}"`;
    return command.trim().replace(/^\//, "").replace(/\{player\}/g, quoted);
}

/** Runs commands as the player (used by event commands and interactive blocks). */
export function runAsPlayer(player: Player, commands: string[]): void {
    for (const command of commands) {
        if (!command.trim()) continue;
        try {
            player.runCommand(prepare(command, player.name));
        } catch (e) {
            console.warn(`[bus:events] join command failed ("${command}"): ${e}`);
        }
    }
}

onPlayerJoin((player, firstJoin) => {
    const c = getEventCommands();
    // Wait a moment so the player has finished spawning before commands target them.
    later(() => {
        if (!player.isValid) return;
        if (firstJoin) runAsPlayer(player, c.firstJoin);
        if (!(firstJoin && c.joinExcludesFirst)) runAsPlayer(player, c.join);
    });
});

onPlayerLeave((player) => {
    const commands = getEventCommands().leave.filter((c) => c.trim());
    if (commands.length === 0) return;
    const name = player.name; // read now: the player is gone by the time these run
    later(() => {
        // The player no longer exists, so these can't use @s; {player} holds their name instead.
        const dimension = world.getDimension("overworld");
        for (const command of commands) {
            try {
                dimension.runCommand(prepare(command, name));
            } catch (e) {
                console.warn(`[bus:events] leave command failed ("${command}"): ${e}`);
            }
        }
    });
});

registerShareable({
    id: KEY,
    label: t("bus.share.event_commands"),
    export: () => getEventCommands(),
    import: (data) => {
        const next = normalizeEventCommands(data);
        if (!next) return t("bus.share.error.generic");
        writeWorldJson(KEY, next);
        return undefined;
    },
});
