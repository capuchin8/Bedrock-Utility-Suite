import { system, world, type Container, type Entity, type Player, type Vector3 } from "@minecraft/server";
import type { UIRawMessage } from "@minecraft/server-ui";
import { raw, t, tell } from "../core/lang";
import { registerShareable } from "../share/shareRegistry";
import { isRecord } from "../core/storage";
import { blockKey } from "./interactStore";
import {
  colorName,
  effectiveSettings,
  getBlockTreasure,
  getDefaults,
  getEntityTreasure,
  hasClaimed,
  listBlockTreasures,
  markClaimed,
  normalizeDefaults,
  removeBlockTreasure,
  setDefaults,
  type Treasure,
} from "./treasureStore";

// Runtime side of treasure containers. The clicks themselves are caught by the existing
// interact listeners in interactBlocks.ts (it calls claimBlockTreasure / claimEntityTreasure).

/** Plays a sound to one player. Blank or "none" means silent. */
export function playTreasureSound(player: Player, soundId: string): void {
  const id = soundId.trim();
  if (!id || id.toLowerCase() === "none") return;
  try {
    player.playSound(id, { volume: 1, pitch: 1 });
  } catch {
    // invalid sound id: nothing to play
  }
}

function nameMessage(name: string): UIRawMessage {
  return name ? raw(colorName(name)) : t("bus.treasure.default_name");
}

function claim(player: Player, treasure: Treasure, container: Container | undefined): void {
  if (!player.isValid) return;
  const s = effectiveSettings(treasure);
  const name = nameMessage(s.name);

  if (hasClaimed(player, treasure)) {
    player.sendMessage(t("bus.treasure.claimed", name));
    playTreasureSound(player, s.errorSound);
    return;
  }

  // Copy what is inside (the container keeps its items, so every player gets the same loot).
  const items = [];
  if (container) {
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item) items.push(item.clone());
    }
  }
  if (items.length === 0) {
    player.sendMessage(t("bus.treasure.empty", name));
    playTreasureSound(player, s.errorSound);
    return;
  }

  const inventory = player.getComponent("minecraft:inventory")?.container;
  let total = 0;
  for (const item of items) {
    total += item.amount;
    // Whatever doesn't fit in their inventory drops at their feet.
    // addItem returns undefined when everything fit, so only fall back to the full stack with no inventory at all.
    const overflow = inventory ? inventory.addItem(item) : item;
    if (overflow) player.dimension.spawnItem(overflow, player.location);
  }

  markClaimed(player, treasure);
  playTreasureSound(player, s.openSound);
  player.sendMessage(t("bus.treasure.found", name, total));
}

/** Deferred from the click (inside system.run): not for use in a before-event. */
export function claimBlockTreasure(player: Player, dimensionId: string, location: Vector3): void {
  const key = blockKey(dimensionId, location);
  const treasure = getBlockTreasure(key);
  if (!treasure) return;
  let block;
  try {
    block = world.getDimension(dimensionId).getBlock(location);
  } catch {
    return;
  }
  if (!block || block.typeId !== treasure.type) {
    removeBlockTreasure(key); // the container was replaced
    return;
  }
  claim(player, treasure, block.getComponent("minecraft:inventory")?.container);
}

export function claimEntityTreasure(player: Player, entity: Entity): void {
  if (!entity.isValid) return;
  const treasure = getEntityTreasure(entity);
  if (!treasure) return;
  claim(player, treasure, entity.getComponent("minecraft:inventory")?.container);
}

// ---- break protection ---------------------------------------------------------------------------
// Only subscribed once at least one treasure block exists (nothing is listening in a world without treasures).
let breakGuardOn = false;

export function ensureBreakGuard(): void {
  if (breakGuardOn) return;
  breakGuardOn = true;
  world.beforeEvents.playerBreakBlock.subscribe((event) => {
    const treasure = getBlockTreasure(blockKey(event.block.dimension.id, event.block.location));
    if (!treasure || treasure.type !== event.block.typeId) return;
    if (!effectiveSettings(treasure).protect) return;
    event.cancel = true;
    tell(event.player, t("bus.treasure.protected"));
  });
}

// World data can't be read while the script is still loading, so look on the first tick.
system.run(() => {
  if (listBlockTreasures().length > 0) ensureBreakGuard();
});

// ---- sharing ------------------------------------------------------------------------------------
// Only the default settings are shared: treasures are tied to positions in one world.
registerShareable({
  id: "bus:treasure_defaults",
  label: t("bus.share.treasure"),
  export: () => ({ defaults: getDefaults() }),
  import: (data) => {
    if (!isRecord(data)) return t("bus.share.error.treasure");
    const defaults = normalizeDefaults(data.defaults);
    if (!defaults) return t("bus.share.error.treasure");
    setDefaults(defaults);
    return undefined;
  },
});
