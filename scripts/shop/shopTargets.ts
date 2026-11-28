import type { Player } from "@minecraft/server";
import { findCategory, treeOf } from "./shopStore";
import { openShop } from "./shopUI";

/** Name of the custom command enum used by /bus:shop. */
export const SHOP_TARGET_ENUM = "bus:shop_target";

/** The fixed words /bus:shop accepts first; "category" is followed by a category id. */
export const SHOP_TARGET_WORDS = ["buy", "sell", "category"];

/** true if `target` is "sell", "buy" or the id of an existing category. */
export function isShopTarget(target: string): boolean {
  return target === "sell" || findCategory(target) !== undefined;
}

/**
 * Opens the shop at a target: nothing = the normal shop entry, "sell" = the sell shop, "buy" = the buy shop,
 * or a category id = that category (in whichever shop it belongs to).
 * Returns false (and opens nothing) if the target doesn't exist. Shows a form, so call it inside
 * system.run from before-events and command callbacks.
 */
export function openShopTarget(player: Player, target?: string): boolean {
  const key = target?.trim();
  if (!key) {
    openShop(player);
    return true;
  }
  if (key === "sell") {
    openShop(player, "sell");
    return true;
  }
  const tree = treeOf(key);
  if (!tree) return false;
  openShop(player, tree, key);
  return true;
}
