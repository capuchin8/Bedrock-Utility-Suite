import type { Vector3 } from "@minecraft/server";
import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";

const KEY = "bus:interactive_blocks";
export const MAX_BLOCK_COMMANDS = 10;
export const MAX_BLOCKS = 100;
/** World dynamic properties hold at most ~32k characters; stay under it. */
const MAX_JSON_LENGTH = 30000;

export interface BlockAction {
    /** Block type at the time it was set up (used to drop the link if the block is replaced). */
    type: string;
    /** Show the rules screen (read-only: no accept toggle). */
    rules: boolean;
    /** Commands run as the player who clicked. {player} = their quoted name. */
    commands: string[];
}

export function blockKey(dimensionId: string, location: Vector3): string {
    return `${dimensionId}|${Math.floor(location.x)}|${Math.floor(location.y)}|${Math.floor(location.z)}`;
}

export function describeKey(key: string): { dimension: string; x: number; y: number; z: number } {
    const [dimension, x, y, z] = key.split("|");
    return { dimension, x: Number(x), y: Number(y), z: Number(z) };
}

function normalize(v: unknown): BlockAction | undefined {
    if (!isRecord(v) || typeof v.type !== "string") return undefined;
    const commands = Array.isArray(v.commands)
        ? v.commands.filter((c): c is string => typeof c === "string").slice(0, MAX_BLOCK_COMMANDS).map((c) => c.slice(0, 256))
        : [];
    return { type: v.type, rules: v.rules === true, commands };
}

function readAll(): Record<string, BlockAction> {
    const raw = readWorldJson<unknown>(KEY, {});
    const out: Record<string, BlockAction> = {};
    if (!isRecord(raw)) return out;
    for (const [key, value] of Object.entries(raw)) {
        const action = normalize(value);
        if (action) out[key] = action;
    }
    return out;
}

export function listBlocks(): [string, BlockAction][] {
    return Object.entries(readAll());
}

export function getBlock(key: string): BlockAction | undefined {
    return readAll()[key];
}

/** Returns false if the list is full or the data would be too large to store. */
export function saveBlock(key: string, action: BlockAction): boolean {
    const all = readAll();
    if (!(key in all) && Object.keys(all).length >= MAX_BLOCKS) return false;
    const clean = normalize(action);
    if (!clean) return false;
    all[key] = clean;
    const json = JSON.stringify(all);
    if (json.length > MAX_JSON_LENGTH) return false;
    writeWorldJson(KEY, all);
    return true;
}

export function removeBlock(key: string): void {
    const all = readAll();
    if (!(key in all)) return;
    delete all[key];
    writeWorldJson(KEY, all);
}
