import { isRecord, notifyDisplayDataChanged, readWorldJson, writeWorldJson } from "../core/storage";

const KEY = "bus:display_settings";

export type NametagPosition = "above" | "below" | "beside";
export type MultiRoleMode = "highest" | "all";

export interface DisplaySettings {
    /** Show roles in chat. When false (and no nickname applies) BUS never touches chat. */
    chatEnabled: boolean;
    /** Chat template. Tokens: {role} (includes trailing space), {name}, {message}. Supports &-codes. */
    chatFormat: string;
    /** Show roles on name tags. When false BUS doesn't write role text to name tags. */
    nametagEnabled: boolean;
    nametagPosition: NametagPosition;
    multiRoleMode: MultiRoleMode;
    /** Joiner used when multiRoleMode is "all". */
    separator: string;
    nicknameInChat: boolean;
    nicknameInNametag: boolean;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
    chatEnabled: true,
    chatFormat: "{role}{name}§r: {message}",
    nametagEnabled: true,
    nametagPosition: "above",
    multiRoleMode: "highest",
    separator: " ",
    nicknameInChat: true,
    nicknameInNametag: true,
};

export function normalizeDisplaySettings(v: unknown): DisplaySettings | undefined {
    if (!isRecord(v)) return undefined;
    const d = DEFAULT_DISPLAY_SETTINGS;
    const bool = (x: unknown, fb: boolean): boolean => (typeof x === "boolean" ? x : fb);
    const str = (x: unknown, fb: string): string => (typeof x === "string" ? x.slice(0, 128) : fb);
    return {
        chatEnabled: bool(v.chatEnabled, d.chatEnabled),
        chatFormat: str(v.chatFormat, d.chatFormat),
        nametagEnabled: bool(v.nametagEnabled, d.nametagEnabled),
        nametagPosition:
            v.nametagPosition === "above" || v.nametagPosition === "below" || v.nametagPosition === "beside"
                ? v.nametagPosition
                : d.nametagPosition,
        multiRoleMode: v.multiRoleMode === "all" || v.multiRoleMode === "highest" ? v.multiRoleMode : d.multiRoleMode,
        separator: str(v.separator, d.separator),
        nicknameInChat: bool(v.nicknameInChat, d.nicknameInChat),
        nicknameInNametag: bool(v.nicknameInNametag, d.nicknameInNametag),
    };
}

export function getDisplaySettings(): DisplaySettings {
    return normalizeDisplaySettings(readWorldJson<unknown>(KEY, {})) ?? DEFAULT_DISPLAY_SETTINGS;
}

export function setDisplaySettings(patch: Partial<DisplaySettings>): void {
    const next = normalizeDisplaySettings({ ...getDisplaySettings(), ...patch });
    if (!next) return;
    writeWorldJson(KEY, next);
    notifyDisplayDataChanged();
}
