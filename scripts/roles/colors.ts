import { t } from "../core/lang";

export const COLOR_OPTIONS = [
    { key: "default", code: "" },
    { key: "red", code: "c" },
    { key: "dark_red", code: "4" },
    { key: "gold", code: "6" },
    { key: "yellow", code: "e" },
    { key: "green", code: "a" },
    { key: "dark_green", code: "2" },
    { key: "aqua", code: "b" },
    { key: "dark_aqua", code: "3" },
    { key: "blue", code: "9" },
    { key: "dark_blue", code: "1" },
    { key: "light_purple", code: "d" },
    { key: "dark_purple", code: "5" },
    { key: "white", code: "f" },
    { key: "gray", code: "7" },
    { key: "dark_gray", code: "8" },
] as const;

/** Dropdown items (translated names) for any color picker. */
export const COLOR_ITEMS = COLOR_OPTIONS.map((c, i) => ({ label: t(`bus.color.${c.key}`), value: i }));

export function colorIndex(code: string): number {
    const i = COLOR_OPTIONS.findIndex((c) => c.code === code);
    return i < 0 ? 0 : i;
}

export function colorPrefix(code: string): string {
    return code ? `§${code}` : "";
}
