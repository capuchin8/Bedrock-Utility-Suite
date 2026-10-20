import type { Player } from "@minecraft/server";
import { getNickname } from "../nicknames/nicknameStore";
import { colorPrefix } from "./colors";
import { expandText, getDisplayName, getRoleLabel, getTopRole } from "./display";
import { getDisplaySettings } from "./displaySettings";

/**
 * The chat line exactly as the "Role display" settings (chat format, role colours, nicknames)
 * build it. Returns undefined when normal chat would be left as vanilla (no role and no nickname to
 * show); callers then use vanillaChatLine. Used by normal chat, staff chat and muted-message copies
 * so they all look the same.
 */
export function formatChatLine(sender: Player, message: string): string | undefined {
    const s = getDisplaySettings();
    const role = s.chatEnabled ? getRoleLabel(sender) : "";
    const hasNickname = s.nicknameInChat && !!getNickname(sender);
    if (!role && !hasNickname) return undefined;

    const top = s.chatEnabled ? getTopRole(sender) : undefined;
    const name = `${colorPrefix(top?.nameColor ?? "")}${getDisplayName(sender, "chat")}\u00A7r`;
    const text = `${colorPrefix(top?.chatColor ?? "")}${message}`;
    const rolePrefix = role ? `${role} ` : "";

    // One pass with a function replacer so "$&" etc. in messages stay literal.
    return expandText(s.chatFormat).replace(/\{(role|name|message)\}/g, (_m, token: string) =>
        token === "role" ? rolePrefix : token === "name" ? name : text
    );
}

export function vanillaChatLine(sender: Player, message: string): string {
    return `<${sender.name}> ${message}`;
}

/** The line to show for this message: the configured format, or the vanilla look if none applies. */
export function chatLineOrVanilla(sender: Player, message: string): string {
    return formatChatLine(sender, message) ?? vanillaChatLine(sender, message);
}
