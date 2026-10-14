import type { Player } from "@minecraft/server";
import { getNickname } from "../nicknames/nicknameStore";
import { getDisplaySettings } from "./displaySettings";
import { getPlayerRoleIds, getRoles, type RoleDefinition } from "./roleStore";

/**
 * Turns admin-typed text into game text:
 *  - "&c" becomes "§c" (easier to type than §)
 *  - "\uE200" becomes the actual glyph character from your resource pack's glyph sheet
 */
export function expandText(raw: string): string {
    return raw
        .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&([0-9a-fk-or])/gi, "§$1");
}

/** Player's roles, highest priority first. */
export function getPlayerRoleDefs(player: Player): RoleDefinition[] {
    const roles = getRoles();
    return getPlayerRoleIds(player)
        .map((id) => roles[id])
        .filter((r): r is RoleDefinition => !!r)
        .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

export function getTopRole(player: Player): RoleDefinition | undefined {
    return getPlayerRoleDefs(player)[0];
}

/** Role text per the "highest only / all" setting. Empty string if the player has no displayable role. */
export function getRoleLabel(player: Player): string {
    const s = getDisplaySettings();
    const defs = getPlayerRoleDefs(player).filter((r) => r.text.trim());
    if (defs.length === 0) return "";
    const picked = s.multiRoleMode === "highest" ? defs.slice(0, 1) : defs;
    return expandText(picked.map((r) => r.text).join(s.separator)) + "§r";
}

export function getDisplayName(player: Player, context: "chat" | "nametag"): string {
    const s = getDisplaySettings();
    const nickname = getNickname(player);
    const allowed = context === "chat" ? s.nicknameInChat : s.nicknameInNametag;
    return allowed && nickname ? nickname : player.name;
}

/** Removes § formatting codes. Button text shows them as raw characters, so strip them there. */
export function stripFormatting(text: string): string {
    return text.replace(/§[0-9a-v]/gi, "");
}
