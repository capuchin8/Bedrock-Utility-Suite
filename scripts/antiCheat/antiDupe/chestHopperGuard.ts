import type { Block, PlayerInteractWithBlockAfterEvent, Vector3 } from "@minecraft/server";
import { onBlockInteract } from "../../events/blockInteractEvents";
import { CHUNK_SIZE, isInsideWorld } from "./antiDupeConfig";
import { alertStaff } from "./antiDupeAlerts";
import { defineAntiDupeRule } from "./antiDupeRule";
import { destroyBlock } from "./destroyBlock";

/**
 * Rule "chest": when a player opens a double chest that straddles a chunk border and a POWERED
 * (locked) hopper sits under either half, that hopper is broken (and drops as an item).
 * Double chests across chunk borders stay allowed; the exploit needs a hopper that is switched off while
 * the chest is filled, then switched on while one half of the chest is in an unloaded chunk.
 */

const HOPPER_ID = "minecraft:hopper";
const CHUNK_SIDES = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

const chunkOf = (n: number): number => Math.floor(n / CHUNK_SIZE);

function isChest(typeId: string): boolean {
  return (
    typeId === "minecraft:chest" ||
    typeId === "minecraft:trapped_chest" ||
    typeId.endsWith("_copper_chest") ||
    typeId === "minecraft:copper_chest"
  );
}

/** Positions of the loaded halves of a double chest that crosses a chunk border, or undefined. */
function crossBorderHalves(block: Block): Vector3[] | undefined {
  const container = block.getComponent("minecraft:inventory")?.container;
  if (container === undefined || container.size < 54) return undefined; // not a double chest

  const dim = block.dimension;
  const { x, y, z } = block.location;
  const sameChunkPartner = CHUNK_SIDES.some((d) => {
    if (chunkOf(x + d.x) !== chunkOf(x) || chunkOf(z + d.z) !== chunkOf(z)) return false;
    try {
      return dim.getBlock({ x: x + d.x, y, z: z + d.z })?.typeId === block.typeId;
    } catch {
      return false;
    }
  });
  if (sameChunkPartner) return undefined; // both halves are in this chunk

  const halves: Vector3[] = [{ x, y, z }];
  let crosses = false;
  for (const d of CHUNK_SIDES) {
    const n = { x: x + d.x, y, z: z + d.z };
    if (chunkOf(n.x) === chunkOf(x) && chunkOf(n.z) === chunkOf(z)) continue;
    if (!dim.isChunkLoaded(n)) {
      crosses = true; // the other half is in an unloaded chunk
      continue;
    }
    try {
      if (dim.getBlock(n)?.typeId === block.typeId) {
        crosses = true;
        halves.push(n);
      }
    } catch {
      // chunk unloaded between the two calls: treat as the unloaded half
      crosses = true;
    }
  }
  return crosses ? halves : undefined;
}

const onInteract = ({ block }: PlayerInteractWithBlockAfterEvent): void => {
  if (!isChest(block.typeId)) return;
  const halves = crossBorderHalves(block);
  if (halves === undefined) return;

  const dim = block.dimension;
  for (const half of halves) {
    const belowLoc = { x: half.x, y: half.y - 1, z: half.z };
    if (!isInsideWorld(dim, belowLoc.y)) continue;
    try {
      const below = dim.getBlock(belowLoc);
      // toggle_bit on a hopper is true while it is powered (locked)
      if (below?.typeId === HOPPER_ID && below.permutation.getState("toggle_bit") === true) {
        if (destroyBlock(dim, belowLoc))
          alertStaff("bus.anti_dupe.alert.chest_hopper", belowLoc.x, belowLoc.y, belowLoc.z);
      }
    } catch {
      // chunk not loaded: nothing to do there
    }
  }
};

let remove: (() => void) | undefined;

defineAntiDupeRule("chest", {
  start: () => {
    remove = onBlockInteract(onInteract);
  },
  stop: () => {
    remove?.();
    remove = undefined;
  },
});
