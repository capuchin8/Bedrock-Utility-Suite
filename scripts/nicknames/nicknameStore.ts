import { world, type Player } from "@minecraft/server";
import type { UIRawMessage } from "@minecraft/server-ui";
import { t } from "../core/lang";
import { notifyDisplayDataChanged } from "../core/storage";

const KEY = "bus:nickname";
export const MAX_NICKNAME_LENGTH = 24;

export function getNickname(player: Player): string | undefined {
    const v = player.getDynamicProperty(KEY);
    return typeof v === "string" && v ? v : undefined;
}

export function setNickname(player: Player, nickname: string | undefined): void {
    player.setDynamicProperty(KEY, nickname || undefined);
    notifyDisplayDataChanged();
}

/**
 * `error` is for forms (can take arguments); `commandKey`/`fallback` are for command responses,
 * which can't take arguments.
 */
export type NicknameCheck =
    | { ok: true; value: string }
    | { ok: false; error: UIRawMessage; commandKey: string; fallback: string };

/**
 * Validates and cleans a nickname. Non-operators can't use § formatting or private-use
 * glyphs, which stops players from faking a role icon in their name.
 */
export function checkNickname(target: Player, raw: string, allowFormatting: boolean): NicknameCheck {
    let value = raw.replace(/[\r\n]/g, " ").trim();
    if (!allowFormatting) value = value.replace(/§./g, "").replace(/[\uE000-\uF8FF]/g, "");

    const visible = value.replace(/§./g, "");
    if (!visible) return { ok: false, error: t("bus.nickname.error.empty"), commandKey: "bus.command.nickname.empty", fallback: "Nickname can't be empty." };
    if (visible.length > MAX_NICKNAME_LENGTH) {
        return { ok: false, error: t("bus.nickname.error.too_long", MAX_NICKNAME_LENGTH), commandKey: "bus.command.nickname.too_long", fallback: "Nickname is too long." };
    }

    const lower = visible.toLowerCase();
    for (const other of world.getAllPlayers()) {
        if (other.id === target.id) continue;
        if (other.name.toLowerCase() === lower) return { ok: false, error: t("bus.nickname.error.player_name"), commandKey: "bus.command.nickname.player_name", fallback: "That name belongs to another player." };
        const nick = getNickname(other)?.replace(/§./g, "").toLowerCase();
        if (nick === lower) return { ok: false, error: t("bus.nickname.error.in_use"), commandKey: "bus.command.nickname.in_use", fallback: "That nickname is already in use." };
    }
    return { ok: true, value };
}
