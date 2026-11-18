import { getIconOverride } from "../ui/itemPicker/iconOverrideStore";
import { resolveItemIcon } from "../ui/itemPicker/itemIconMap";
import { resolvePotionIcon } from "./potionIcons";
import type { ShopPotion } from "./shopTypes";

/** Items whose vanilla texture name differs from their item id. */
const ALIASES: Record<string, string> = {
  firework_rocket: "textures/items/fireworks",
  firework_star: "textures/items/fireworks_charge",
};

export function getIconFor(itemId: string, override?: string, potion?: ShopPotion): string {
  if (override) return override;
  // An icon set in Settings > Item icons beats the built-in potion / alias tables.
  const admin = getIconOverride(itemId);
  if (admin) return admin;
  const potionIcon = resolvePotionIcon(itemId, potion?.effect);
  if (potionIcon) return potionIcon;
  const short = itemId.replace(/^[a-z0-9_.-]+:/, "");
  if (ALIASES[short]) return ALIASES[short];
  try {
    const resolved = resolveItemIcon(itemId);
    if (resolved) return resolved;
  } catch {
    // fall through
  }
  return `textures/items/${short}`;
}
