import type { Block, Container, Dimension, Vector3 } from "@minecraft/server";

/**
 * bus:anti-dupe shared config and helpers.
 *
 * Core rule: hoppers, dispensers and droppers may never hold a bundle. Both known bundle dupes
 * (piston-shuffled hopper pair, dispense-into-lava with nested bundles) need a bundle sitting
 * inside one of these three blocks, so removing that precondition closes both.
 */

export const HOPPER_ID = "minecraft:hopper";

/** Block types whose inventories are never allowed to hold a bundle. */
export const MONITORED_BLOCK_IDS: ReadonlySet<string> = new Set([
  HOPPER_ID,
  "minecraft:dispenser",
  "minecraft:dropper",
]);

/** How often (ticks) the watch list is checked. It only runs while something is being watched. */
export const WATCH_INTERVAL_TICKS = 2;
/** How long a block stays watched after the last event that touched it (30 seconds). */
export const WATCH_DURATION_TICKS = 600;
/** Shorter watch for hoppers near a freshly spawned bundle item (5 seconds). */
export const ITEM_WATCH_DURATION_TICKS = 100;
/**
 * A player who clicked a hopper/dropper/dispenser keeps it watched for as long as they have not moved
 * their camera: while a container screen is open the mouse drives the screen, not the camera, so a
 * changed look direction means the screen is closed. (Position is NOT used: being punched or pushed by
 * water moves the player without closing the screen.) After the camera moves it is watched this much longer.
 */
export const VIEWER_GRACE_TICKS = 100;
/** How far (degrees, pitch or yaw) the camera may drift from where it was at the click before the player counts as "looking away". */
export const VIEWER_LOOK_TOLERANCE_DEG = 2;
/** The same block never alerts staff twice within this many ticks (one removal can look like two when the item is re-collected). */
export const ALERT_COOLDOWN_TICKS = 40;
/** Piston guard: how many blocks in front of a piston are checked for an unloaded chunk (the arm plus a pushed falling block). */
export const PISTON_LOOKAHEAD = 3;
/** Piston guard: a falling block within this many blocks of the piston counts as "being pushed". */
export const PISTON_FALLING_BLOCK_RADIUS = 5;
/** Piston guard (falling-block trigger): how far down a spawned falling block's column is searched for pistons aimed at it. */
export const PISTON_FALL_SCAN = 8;
/** A chunk is 16 blocks wide in X and Z. */
export const CHUNK_SIZE = 16;
/** Blocks around a spawned bundle item that are searched for hoppers/droppers/dispensers. */
export const ITEM_WATCH_RADIUS = 3;
/** Horizontal speed given to a bundle ejected from a hopper so it clears the hopper's pickup area. */
export const EJECT_SPEED = 0.15;

/** The default bundle or any dyed variant. Suffix match so future variants are covered too. */
export function isBundleTypeId(typeId: string): boolean {
  return typeId === "minecraft:bundle" || typeId.endsWith("_bundle");
}

/** True when y is inside the dimension's build height (heightRange.max is exclusive). */
export function isInsideWorld(dimension: Dimension, y: number): boolean {
  const range = dimension.heightRange;
  return y >= range.min && y < range.max;
}

const SIDES: { x: number; z: number; get: (b: Block) => Block | undefined }[] = [
  { x: 0, z: -1, get: (b) => b.north() },
  { x: 0, z: 1, get: (b) => b.south() },
  { x: 1, z: 0, get: (b) => b.east() },
  { x: -1, z: 0, get: (b) => b.west() },
];

/** First horizontal direction whose neighbor is empty air (so the item isn't shoved into a wall or another hopper). */
function pickOpenSide(block: Block): Vector3 | undefined {
  for (const side of SIDES) {
    try {
      if (side.get(block)?.isAir) return { x: side.x, y: 0, z: side.z };
    } catch {
      // neighbor in an unloaded chunk: skip it
    }
  }
  return undefined;
}

/**
 * Removes a bundle from a container slot and returns it to the world as a dropped item.
 * Hoppers: spawned at the hopper's center and pushed sideways, so it can't be sucked straight back in
 * (a drop above a hopper gets collected again, which looped before). Other blocks: dropped just above.
 * Returns true if a bundle was removed.
 */
export function ejectBundle(container: Container, slot: number, block: Block): boolean {
  const item = container.getItem(slot);
  if (item === undefined || !isBundleTypeId(item.typeId)) return false;

  container.setItem(slot, undefined);
  const { x, y, z } = block.location;

  if (block.typeId !== HOPPER_ID) {
    block.dimension.spawnItem(item, { x: x + 0.5, y: y + 1, z: z + 0.5 });
    return true;
  }

  const dropped = block.dimension.spawnItem(item, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  const side = pickOpenSide(block);
  if (side) {
    try {
      dropped.applyImpulse({ x: side.x * EJECT_SPEED, y: 0, z: side.z * EJECT_SPEED });
    } catch {
      // item entity already gone: nothing to push
    }
  }
  return true;
}
