import { t } from "../core/lang";

/**
 * Color choices for floating scoreboards. One table keeps each dropdown name and its
 * color code together, so the two can never drift apart. Names are lang keys:
 * bus.floatingtext.color.<key>.
 */
export const FLOATING_COLORS = [
  { key: "dark_red", code: "§4" },
  { key: "mahogany_red", code: "§m" },
  { key: "red", code: "§c" },
  { key: "gold", code: "§6" },
  { key: "dandelion", code: "§p" },
  { key: "honey", code: "§g" },
  { key: "yellow", code: "§e" },
  { key: "dark_green", code: "§2" },
  { key: "forest_green", code: "§q" },
  { key: "lime_green", code: "§a" },
  { key: "aqua", code: "§b" },
  { key: "dark_aqua", code: "§3" },
  { key: "cadet_blue", code: "§s" },
  { key: "teal", code: "§t" },
  { key: "dark_blue", code: "§1" },
  { key: "grape", code: "§9" },
  { key: "light_purple", code: "§d" },
  { key: "dark_lavender", code: "§u" },
  { key: "dark_purple", code: "§5" },
  { key: "brown", code: "§n" },
  { key: "white", code: "§f" },
  { key: "off_white", code: "§h" },
  { key: "gray", code: "§7" },
  { key: "dark_gray", code: "§8" },
  { key: "charcoal", code: "§j" },
  { key: "black", code: "§0" },
] as const;

/** Dropdown items (translated names) for any floating-scoreboard color picker. */
export const FLOATING_COLOR_ITEMS = FLOATING_COLORS.map((c, i) => ({
  label: t(`bus.floatingtext.color.${c.key}`),
  value: i,
}));

/** Dropdown index for a stored color code (falls back if the code isn't in the table). */
export function colorIndexOf(code: string, fallback = 0): number {
  const i = FLOATING_COLORS.findIndex((c) => c.code === code);
  return i < 0 ? fallback : i;
}

/** Color code for a dropdown index. */
export function colorCodeAt(index: number): string {
  return FLOATING_COLORS[Math.round(index)]?.code ?? "§f";
}
