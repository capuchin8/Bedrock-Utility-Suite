import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";

// Extra owners, stored by player id. The host of a client-hosted world is always an owner
// without being listed; this list exists for dedicated servers and shared worlds.
const KEY = "bus:owners";

function load(): Record<string, string> {
    const v = readWorldJson<unknown>(KEY, {});
    if (!isRecord(v)) return {};
    const out: Record<string, string> = {};
    for (const [id, name] of Object.entries(v)) if (typeof name === "string") out[id] = name;
    return out;
}

/** player id -> last known name */
export function getListedOwners(): Record<string, string> {
    return load();
}

export function isListedOwner(playerId: string): boolean {
    return playerId in load();
}

export function addListedOwner(playerId: string, name: string): void {
    writeWorldJson(KEY, { ...load(), [playerId]: name });
}

export function removeListedOwner(playerId: string): void {
    const all = load();
    delete all[playerId];
    writeWorldJson(KEY, all);
}

export function hasListedOwners(): boolean {
    return Object.keys(load()).length > 0;
}
