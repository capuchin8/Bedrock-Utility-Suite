import { world, type EntitySpawnAfterEvent, type PistonActivateAfterEvent } from "@minecraft/server";
import { onEntitySpawn } from "../../events/entitySpawnEvents";
import { onPistonActivate } from "../../events/pistonEvents";
import {
  CHUNK_SIZE,
  PISTON_FALL_SCAN,
  PISTON_FALLING_BLOCK_RADIUS,
  PISTON_LOOKAHEAD,
  isInsideWorld,
} from "./antiDupeConfig";
import { alertStaff } from "./antiDupeAlerts";
import { defineAntiDupeRule } from "./antiDupeRule";
import { destroyBlock } from "./destroyBlock";

/**
 * Rule "piston": a piston that pushes a falling block toward a chunk that is not loaded is broken
 * (and drops as an item). Pushing a falling block across the edge of the loaded area duplicates it
 * when the chunk reloads.
 *
 * Findings from testing, which this file is built on:
 *  - The dupe only works when the block is pushed SOUTH (+z) or EAST (+x), so only those two
 *    directions are checked.
 *  - A piston's facing_direction number did not match the table I assumed (a piston pushing south
 *    reported 2), so the number is only used to tell which AXIS the piston is on (2/3 = z, 4/5 = x),
 *    never which way along it. A piston on the right axis, behind the falling block, counts.
 *  - A piston whose push is blocked may never fire pistonActivate, so the main trigger is the falling
 *    block's spawn (every clock cycle spawns one).
 *
 * Triggers:
 *  1. A falling block spawns within PISTON_LOOKAHEAD blocks of the east/south edge of its chunk and an
 *     unloaded chunk lies beyond it: pistons on that axis behind the block (up to PISTON_LOOKAHEAD
 *     back, PISTON_FALL_SCAN blocks down the column) are broken. Arithmetic on the coordinates rules
 *     out almost every spawn first, so only edge spawns do any lookups.
 *  2. pistonActivate: a piston whose east/south push line reaches an unloaded chunk with a falling
 *     block near it.
 * There is no before-event for pistons, so a piston can only be broken right after the fact.
 */

// The two directions the dupe works in. `facings` = the piston facing_direction values on that axis.
const SIDES = [
  { name: "south", x: 0, z: 1, facings: [2, 3] },
  { name: "east", x: 1, z: 0, facings: [4, 5] },
];
const PISTON_IDS: ReadonlySet<string> = new Set(["minecraft:piston", "minecraft:sticky_piston"]);

/** true when n is within PISTON_LOOKAHEAD blocks of the east/south border of its chunk. */
function nearPositiveBorder(n: number): boolean {
  const m = ((Math.floor(n) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return m >= CHUNK_SIZE - PISTON_LOOKAHEAD;
}

// Trigger 1: a falling block appeared at the east/south edge of the loaded area.
const onFallingBlock = ({ entity }: EntitySpawnAfterEvent): void => {
  if (!entity.isValid || entity.typeId !== "minecraft:falling_block") return;
  const bx = Math.floor(entity.location.x);
  const by = Math.floor(entity.location.y);
  const bz = Math.floor(entity.location.z);
  const nearSouth = nearPositiveBorder(bz);
  const nearEast = nearPositiveBorder(bx);
  if (!nearSouth && !nearEast) return; // almost every spawn ends here

  const dim = entity.dimension;
  if (!isInsideWorld(dim, by)) return;

  for (const side of SIDES) {
    if (!(side.name === "south" ? nearSouth : nearEast)) continue;

    let unloaded = false;
    for (let d = 1; d <= PISTON_LOOKAHEAD; d++) {
      if (!dim.isChunkLoaded({ x: bx + side.x * d, y: by, z: bz + side.z * d })) {
        unloaded = true;
        break;
      }
    }
    if (!unloaded) continue;

    // Pistons behind the block (the side away from the unloaded chunk), on this axis.
    for (let dy = 0; dy <= PISTON_FALL_SCAN; dy++) {
      const cy = by - dy;
      if (!isInsideWorld(dim, cy)) break;
      for (let j = 1; j <= PISTON_LOOKAHEAD; j++) {
        const p = { x: bx - side.x * j, y: cy, z: bz - side.z * j };
        try {
          const block = dim.getBlock(p);
          if (block === undefined || !PISTON_IDS.has(block.typeId)) continue;
          const facing = block.permutation.getState("facing_direction");
          if (typeof facing === "number" && side.facings.includes(facing)) {
            const destroyed = destroyBlock(dim, p);
            if (destroyed) alertStaff("bus.anti_dupe.alert.piston", p.x, p.y, p.z);
          }
        } catch {
          // chunk not loaded: no piston to break there
        }
      }
    }
  }
};

// Trigger 2: a piston fired with its east/south push line reaching an unloaded chunk and a falling block nearby.
const onPiston = ({ dimension, block }: PistonActivateAfterEvent): void => {
  const facing = block.permutation.getState("facing_direction");
  const side = typeof facing === "number" ? SIDES.find((s) => s.facings.includes(facing)) : undefined;
  if (side === undefined) return; // vertical piston, or not on the east/south axes

  const { x, y, z } = block.location;
  if (!isInsideWorld(dimension, y)) return;
  let reachesUnloaded = false;
  for (let i = 1; i <= PISTON_LOOKAHEAD; i++) {
    if (!dimension.isChunkLoaded({ x: x + side.x * i, y, z: z + side.z * i })) {
      reachesUnloaded = true;
      break;
    }
  }
  if (!reachesUnloaded) return;

  const falling = dimension.getEntities({
    type: "minecraft:falling_block",
    location: block.center(),
    maxDistance: PISTON_FALLING_BLOCK_RADIUS,
  });
  if (falling.length === 0) return;

  if (destroyBlock(dimension, block.location)) alertStaff("bus.anti_dupe.alert.piston", x, y, z);
};

let removers: (() => void)[] = [];

defineAntiDupeRule("piston", {
  start: () => {
    removers = [onEntitySpawn(onFallingBlock), onPistonActivate(onPiston)];
  },
  stop: () => {
    for (const remove of removers) remove();
    removers = [];
  },
});
