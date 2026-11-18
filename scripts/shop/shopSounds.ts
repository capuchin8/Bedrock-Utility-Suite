import type { Player } from "@minecraft/server";
import { getShop } from "./shopStore";
import type { ShopSound } from "./shopTypes";

/** Plays one configured sound to a player. An empty id is silent. Not for restricted-execution contexts. */
export function playSound(player: Player, sound: ShopSound): void {
  if (!sound.id) return;
  try {
    player.playSound(sound.id, { volume: sound.volume, pitch: sound.pitch });
  } catch (e) {
    console.warn(`[bus:shop] could not play sound "${sound.id}": ${e}`);
  }
}

/** The purchase / sale result sound (success or failure) from the shop settings. */
export function playShopSound(player: Player, success: boolean): void {
  const sounds = getShop().sounds;
  playSound(player, success ? sounds.success : sounds.failure);
}
