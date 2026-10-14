import type { Player } from "@minecraft/server";
import { isRecord, notifyDisplayDataChanged, readWorldJson, writeWorldJson } from "../core/storage";

const ROLES_KEY = "bus:roles_defs"; // world property: role definitions
const PLAYER_ROLES_KEY = "bus:roles"; // player property: array of role ids

export interface RoleDefinition {
    /** Admin-facing name shown in settings. */
    name: string;
    /** Text shown in chat/name tags. Supports &c style codes and \uE200 style glyph escapes. */
    text: string;
    /** Higher wins. Decides the "highest role" and the order when showing all. */
    priority: number;
    /** Color code character for the player's name ("" = default). */
    nameColor: string;
    /** Color code character for the chat message ("" = default). */
    chatColor: string;
}

export type RoleMap = Record<string, RoleDefinition>;

export function normalizeRole(v: unknown): RoleDefinition | undefined {
    if (!isRecord(v) || typeof v.name !== "string") return undefined;
    const code = (x: unknown): string => (typeof x === "string" ? x.slice(0, 1) : "");
    return {
        name: v.name.slice(0, 32),
        text: typeof v.text === "string" ? v.text.slice(0, 64) : `[${v.name}]`,
        priority: typeof v.priority === "number" && Number.isFinite(v.priority) ? Math.round(v.priority) : 0,
        nameColor: code(v.nameColor),
        chatColor: code(v.chatColor),
    };
}

export function normalizeRoleMap(v: unknown): RoleMap | undefined {
    if (!isRecord(v)) return undefined;
    const out: RoleMap = {};
    for (const [id, raw] of Object.entries(v)) {
        const role = normalizeRole(raw);
        if (!role) return undefined;
        out[id] = role;
    }
    return out;
}

export function getRoles(): RoleMap {
    return normalizeRoleMap(readWorldJson<unknown>(ROLES_KEY, {})) ?? {};
}

export function replaceRoles(roles: RoleMap): void {
    writeWorldJson(ROLES_KEY, roles);
    notifyDisplayDataChanged();
}

/** Returns the new role id, or undefined if the name is empty or already taken. */
export function createRole(name: string): string | undefined {
    const trimmed = name.trim();
    const id = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!id) return undefined;
    const roles = getRoles();
    if (roles[id]) return undefined;
    roles[id] = { name: trimmed.slice(0, 32), text: `[${trimmed}]`, priority: 0, nameColor: "", chatColor: "" };
    replaceRoles(roles);
    return id;
}

export function updateRole(id: string, patch: Partial<RoleDefinition>): void {
    const roles = getRoles();
    const role = roles[id];
    if (!role) return;
    roles[id] = normalizeRole({ ...role, ...patch }) ?? role;
    replaceRoles(roles);
}

export function deleteRole(id: string): void {
    const roles = getRoles();
    delete roles[id];
    replaceRoles(roles);
    // Players keep the stale id; lookups ignore ids with no definition.
}

export function getPlayerRoleIds(player: Player): string[] {
    const raw = player.getDynamicProperty(PLAYER_ROLES_KEY);
    if (typeof raw !== "string") return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
        return [];
    }
}

function savePlayerRoleIds(player: Player, ids: string[]): void {
    player.setDynamicProperty(PLAYER_ROLES_KEY, JSON.stringify(ids));
    notifyDisplayDataChanged();
}

export function grantRole(player: Player, roleId: string): void {
    const ids = getPlayerRoleIds(player);
    if (!ids.includes(roleId)) savePlayerRoleIds(player, [...ids, roleId]);
}

export function revokeRole(player: Player, roleId: string): void {
    savePlayerRoleIds(player, getPlayerRoleIds(player).filter((id) => id !== roleId));
}
