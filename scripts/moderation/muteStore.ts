import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";

const KEY = "bus:mutes";
export const MAX_MUTES = 150; // keeps the stored JSON far below the dynamic-property size limit
export const MAX_REASON_LENGTH = 100;

export interface MuteRecord {
    /** Name at the time of the mute (the id is what identifies the player). */
    name: string;
    reason: string;
    /** Who muted them: a player name or "Console". */
    by: string;
    /** Date.now() when muted. */
    at: number;
    /** Date.now() when the mute ends. Undefined = no end (infinite). */
    until?: number;
}

/** Expired mutes are simply not returned (and disappear from storage on the next write): no timers or polling. */
function readAll(): Record<string, MuteRecord> {
    const raw = readWorldJson<unknown>(KEY, {});
    const out: Record<string, MuteRecord> = {};
    if (!isRecord(raw)) return out;
    const now = Date.now();
    for (const [id, v] of Object.entries(raw)) {
        if (!isRecord(v)) continue;
        const until = typeof v.until === "number" ? v.until : undefined;
        if (until !== undefined && until <= now) continue;
        out[id] = {
            name: typeof v.name === "string" ? v.name : id,
            reason: typeof v.reason === "string" ? v.reason.slice(0, MAX_REASON_LENGTH) : "",
            by: typeof v.by === "string" ? v.by : "",
            at: typeof v.at === "number" ? v.at : 0,
            until,
        };
    }
    return out;
}

export function getMutes(): Record<string, MuteRecord> {
    return readAll();
}

export function getMute(playerId: string): MuteRecord | undefined {
    return readAll()[playerId];
}

export function isMuted(playerId: string): boolean {
    return playerId in readAll();
}

/** Returns false when the list is full (re-muting someone already muted always works). */
export function mutePlayer(playerId: string, record: MuteRecord): boolean {
    const all = readAll();
    if (!(playerId in all) && Object.keys(all).length >= MAX_MUTES) return false;
    all[playerId] = { ...record, reason: record.reason.slice(0, MAX_REASON_LENGTH) };
    writeWorldJson(KEY, all);
    return true;
}

export function unmutePlayer(playerId: string): void {
    const all = readAll();
    if (!(playerId in all)) return;
    delete all[playerId];
    writeWorldJson(KEY, all);
}
