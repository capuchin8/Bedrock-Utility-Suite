import {
  system,
  type Dimension,
  type EntitySpawnAfterEvent,
  type PistonActivateAfterEvent,
  type PlayerInteractWithBlockAfterEvent,
  type Vector3,
} from "@minecraft/server";
import { onBlockInteract } from "../../events/blockInteractEvents";
import { onEntitySpawn } from "../../events/entitySpawnEvents";
import { onPistonActivate } from "../../events/pistonEvents";
import {
  ITEM_WATCH_DURATION_TICKS,
  ITEM_WATCH_RADIUS,
  MONITORED_BLOCK_IDS,
  WATCH_DURATION_TICKS,
  isBundleTypeId,
} from "./antiDupeConfig";
import { defineAntiDupeRule } from "./antiDupeRule";
import { clearWatches, watchBlock, watchMonitoredIn } from "./antiDupeWatcher";

/**
 * Rule "bundle": hoppers, droppers and dispensers may never hold a bundle.
 * The three things that can put a bundle in motion around them each say "look at these blocks for a
 * while"; antiDupeWatcher.ts does the checking. The subscriptions (shared hubs in events/) only exist
 * while the rule is on.
 */

/**
 * A piston-moved block is a "moving block" while the piston animates, so the hopper is not a hopper at
 * its destination yet when pistonActivate fires. We re-check the same small box several times over the
 * animation. Tick 1 was too early in testing, so the first check is at tick 2. Timeouts count game
 * ticks, so server lag stretches the animation and the timeouts together; the extra late checks
 * (14 and 20) are there as margin.
 */
const PISTON_RECHECK_TICKS = [2, 4, 6, 8, 10, 14, 20];
const pendingBoxes = new Set<string>();
let running = false;

function recheckBox(dimension: Dimension, min: Vector3, max: Vector3): void {
  const key = `${dimension.id}|${min.x},${min.y},${min.z}|${max.x},${max.y},${max.z}`;
  if (pendingBoxes.has(key)) return; // the same box is already being rechecked (rapid piston clocks)
  pendingBoxes.add(key);
  const last = PISTON_RECHECK_TICKS[PISTON_RECHECK_TICKS.length - 1];
  for (const delay of PISTON_RECHECK_TICKS) {
    system.runTimeout(() => {
      if (running) watchMonitoredIn(dimension, min, max);
      if (delay === last) pendingBoxes.delete(key);
    }, delay);
  }
}

// minecraft:piston facing_direction: 0 down, 1 up, 2 north (-z), 3 south (+z), 4 west (-x), 5 east (+x)
const FACING: Vector3[] = [
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: -1 },
  { x: 0, y: 0, z: 1 },
  { x: -1, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
];

// 1) A piston fired: recheck the blocks it moves (and where they end up) while the animation plays.
const onPiston = ({ dimension, piston, block }: PistonActivateAfterEvent): void => {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const grow = (l: Vector3, margin: number): void => {
    min.x = Math.min(min.x, l.x - margin);
    min.y = Math.min(min.y, l.y - margin);
    min.z = Math.min(min.z, l.z - margin);
    max.x = Math.max(max.x, l.x + margin);
    max.y = Math.max(max.y, l.y + margin);
    max.z = Math.max(max.z, l.z + margin);
  };

  try {
    const moved = piston.getAttachedBlocksLocations();
    if (moved.length === 0) return;
    // margin 1 covers the destination of a one-block push or pull
    for (const l of moved) grow(l, 1);
  } catch {
    // could not read the moved blocks: fall back to the whole push line in front of the piston
    // (a piston moves at most 12 blocks), plus a margin of 1
    const facing = block.permutation.getState("facing_direction");
    const dir = typeof facing === "number" ? FACING[facing] : undefined;
    if (dir === undefined) {
      grow(block.location, 2);
    } else {
      grow(block.location, 1);
      grow({ x: block.x + dir.x * 13, y: block.y + dir.y * 13, z: block.z + dir.z * 13 }, 1);
    }
  }
  recheckBox(dimension, min, max);
};

// 2) A player right-clicked one (opening it, or spam-clicking it while it moves): watch it, and keep
//    watching for as long as that player has not moved their camera (they can sit in the screen for
//    minutes, then insert the bundle). The click event is the only signal there is: the Script API has
//    no "container opened/closed" or "item inserted" event.
const onInteract = ({ block, player }: PlayerInteractWithBlockAfterEvent): void => {
  if (MONITORED_BLOCK_IDS.has(block.typeId)) {
    watchBlock(block.dimension, block.location, WATCH_DURATION_TICKS, player);
  }
};

// 3) A bundle became a dropped item: a hopper under or next to it can pick it up within a second or two.
const onSpawn = ({ entity }: EntitySpawnAfterEvent): void => {
  if (!entity.isValid || entity.typeId !== "minecraft:item") return;
  const stack = entity.getComponent("minecraft:item")?.itemStack;
  if (stack === undefined || !isBundleTypeId(stack.typeId)) return;

  const { x, y, z } = entity.location;
  watchMonitoredIn(
    entity.dimension,
    { x: x - ITEM_WATCH_RADIUS, y: y - ITEM_WATCH_RADIUS, z: z - ITEM_WATCH_RADIUS },
    { x: x + ITEM_WATCH_RADIUS, y: y + ITEM_WATCH_RADIUS, z: z + ITEM_WATCH_RADIUS },
    ITEM_WATCH_DURATION_TICKS
  );
};

let removers: (() => void)[] = [];

defineAntiDupeRule("bundle", {
  start: () => {
    running = true;
    removers = [onPistonActivate(onPiston), onBlockInteract(onInteract), onEntitySpawn(onSpawn)];
  },
  stop: () => {
    running = false;
    for (const remove of removers) remove();
    removers = [];
    pendingBoxes.clear();
    clearWatches();
  },
});
