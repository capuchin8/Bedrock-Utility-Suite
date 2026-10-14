import { CommandPermissionLevel, PlayerPermissionLevel, type Player } from "@minecraft/server";
import type { UIRawMessage } from "@minecraft/server-ui";
import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";
import { getPlayerRoleIds } from "../roles/roleStore";
import { isListedOwner } from "./owners";

const POLICIES_KEY = "bus:permission_policies";

export interface PermissionDefinition {
    /** Namespaced key, e.g. "bus:shop" (menu) or "bus:nickname" (command). */
    key: string;
    label: UIRawMessage;
    description?: UIRawMessage;
    category: "menu" | "command" | "feature";
    /** Everyone can use it until an admin changes that. Default false. */
    defaultEveryone?: boolean;
    /** Operators can use it until an admin changes that. Default true. */
    defaultOperators?: boolean;
    /** Only the world owner can use it; it never appears in the Permissions screen. */
    ownerOnly?: boolean;
}

export interface PermissionPolicy {
    /** Anyone may use it. */
    everyone: boolean;
    /** Operators may use it (ignored when everyone is true). The world owner always can. */
    operators: boolean;
    /** Role ids that may use it. */
    roles: string[];
}

const defs = new Map<string, PermissionDefinition>();

/** Idempotent: the first registration of a key wins. */
export function registerPermission(def: PermissionDefinition): void {
    if (!def.key.startsWith("bus:")) throw new Error(`Permission key must use the bus: namespace ("${def.key}")`);
    if (!defs.has(def.key)) defs.set(def.key, def);
}

export function getPermissionDefs(): PermissionDefinition[] {
    return [...defs.values()];
}

export function getPermissionDef(key: string): PermissionDefinition | undefined {
    return defs.get(key);
}

export function normalizePolicies(v: unknown): Record<string, PermissionPolicy> | undefined {
    if (!isRecord(v)) return undefined;
    const out: Record<string, PermissionPolicy> = {};
    for (const [key, raw] of Object.entries(v)) {
        if (!isRecord(raw) || typeof raw.everyone !== "boolean" || !Array.isArray(raw.roles)) return undefined;
        out[key] = {
            everyone: raw.everyone,
            operators: typeof raw.operators === "boolean" ? raw.operators : true,
            roles: raw.roles.filter((r): r is string => typeof r === "string"),
        };
    }
    return out;
}

/** Only overrides are stored; anything missing falls back to the registered default. */
export function getStoredPolicies(): Record<string, PermissionPolicy> {
    return normalizePolicies(readWorldJson<unknown>(POLICIES_KEY, {})) ?? {};
}

export function replacePolicies(policies: Record<string, PermissionPolicy>): void {
    writeWorldJson(POLICIES_KEY, policies);
}

export function getPolicy(key: string): PermissionPolicy {
    const def = defs.get(key);
    return (
        getStoredPolicies()[key] ?? {
            everyone: def?.defaultEveryone ?? false,
            operators: def?.defaultOperators ?? true,
            roles: [],
        }
    );
}

export function setPolicy(key: string, policy: PermissionPolicy): void {
    replacePolicies({ ...getStoredPolicies(), [key]: policy });
}

export function resetPolicy(key: string): void {
    const all = getStoredPolicies();
    delete all[key];
    replacePolicies(all);
}

export function purgeRoleFromPolicies(roleId: string): void {
    const all = getStoredPolicies();
    for (const policy of Object.values(all)) policy.roles = policy.roles.filter((r) => r !== roleId);
    replacePolicies(all);
}

export function isOperator(player: Player): boolean {
    return player.playerPermissionLevel === PlayerPermissionLevel.Operator;
}

/**
 * The world owner: the host of a client-hosted world (command permission level Host or higher),
 * or anyone added with /bus:owner (needed on dedicated servers, which have no host player).
 */
export function isOwner(player: Player): boolean {
    try {
        return player.commandPermissionLevel >= CommandPermissionLevel.Host || isListedOwner(player.id);
    } catch {
        return false;
    }
}

/** The one check every command, menu and feature should use. */
export function canUse(player: Player, key: string): boolean {
    try {
        if (isOwner(player)) return true;
        const def = defs.get(key);
        if (!def) return false; // unknown keys are denied (the owner already passed above)
        if (def.ownerOnly) return false;
        const policy = getPolicy(key);
        if (policy.everyone) return true;
        if (policy.operators && isOperator(player)) return true;
        const mine = getPlayerRoleIds(player);
        return policy.roles.some((id) => mine.includes(id));
    } catch {
        return false; // player left or became invalid mid-check
    }
}
