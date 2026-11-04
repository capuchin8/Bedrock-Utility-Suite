import { system, type Dimension, type Player, type Vector3 } from "@minecraft/server";
import {
  MONITORED_BLOCK_IDS,
  VIEWER_GRACE_TICKS,
  VIEWER_LOOK_TOLERANCE_DEG,
  WATCH_DURATION_TICKS,
  WATCH_INTERVAL_TICKS,
  ejectBundle,
  isInsideWorld,
} from "./antiDupeConfig";
import { alertStaffBundleRemoved } from "./antiDupeAlerts";

/**
 * The watch list: a handful of hopper/dispenser/dropper blocks that an event just pointed at.
 * One shared interval checks only those blocks, and it only exists while the list is not empty
 * (started by the first watch, cleared as soon as the list drains). Nothing scans the world.
 */
interface Viewer {
  player: Player;
  pitch: number; // camera direction when the player clicked the block
  yaw: number;
}

interface Watched {
  dimension: Dimension;
  location: Vector3;
  expiresAt: number;
  /** Players who clicked this block and have not moved their camera since. While any is still, the watch never expires. */
  viewers: Map<string, Viewer>;
}

const watched = new Map<string, Watched>();
let loop: number | undefined;

const keyOf = (dimension: Dimension, l: Vector3): string =>
  `${dimension.id}|${Math.floor(l.x)}|${Math.floor(l.y)}|${Math.floor(l.z)}`;

/** Strips bundles from one block. Returns false when the block should no longer be watched. */
function scrub(dimension: Dimension, location: Vector3): boolean {
  if (!isInsideWorld(dimension, location.y)) return false;
  try {
    const block = dimension.getBlock(location);
    if (block === undefined || !MONITORED_BLOCK_IDS.has(block.typeId)) return false;
    const container = block.getComponent("minecraft:inventory")?.container;
    if (container === undefined) return false;
    for (let slot = 0; slot < container.size; slot++) {
      if (ejectBundle(container, slot, block)) {
        alertStaffBundleRemoved(block.typeId, block.x, block.y, block.z);
      }
    }
    return true;
  } catch {
    // unloaded chunk or invalid dimension: stop watching it
    return false;
  }
}

function isStillViewing(w: Watched, v: Viewer): boolean {
  const { player } = v;
  if (!player.isValid || player.dimension.id !== w.dimension.id) return false;
  const r = player.getRotation();
  // yaw wraps around at +-180, so compare the shortest way round
  const yawDiff = Math.abs(((r.y - v.yaw + 540) % 360) - 180);
  return Math.abs(r.x - v.pitch) <= VIEWER_LOOK_TOLERANCE_DEG && yawDiff <= VIEWER_LOOK_TOLERANCE_DEG;
}

function tick(): void {
  const now = system.currentTick;
  for (const [key, w] of watched) {
    for (const [id, v] of w.viewers) {
      if (isStillViewing(w, v)) w.expiresAt = Math.max(w.expiresAt, now + VIEWER_GRACE_TICKS);
      else w.viewers.delete(id);
    }
    if (w.expiresAt <= now || !scrub(w.dimension, w.location)) watched.delete(key);
  }
  if (watched.size === 0) stop();
}

function start(): void {
  if (loop === undefined) loop = system.runInterval(tick, WATCH_INTERVAL_TICKS);
}

function stop(): void {
  if (loop !== undefined) system.clearRun(loop);
  loop = undefined;
}

/** Drops every watched block and stops the timer (used when anti dupe is switched off). */
export function clearWatches(): void {
  watched.clear();
  stop();
}

/** Watches one block (refreshes the timer if it is already watched). Ignores anything outside the world. */
export function watchBlock(
  dimension: Dimension,
  location: Vector3,
  ticks = WATCH_DURATION_TICKS,
  viewer?: Player
): void {
  if (!isInsideWorld(dimension, location.y)) return;
  const key = keyOf(dimension, location);
  const expiresAt = system.currentTick + ticks;
  let entry = watched.get(key);
  if (entry) entry.expiresAt = Math.max(entry.expiresAt, expiresAt);
  else {
    entry = {
      dimension,
      location: { x: Math.floor(location.x), y: Math.floor(location.y), z: Math.floor(location.z) },
      expiresAt,
      viewers: new Map(),
    };
    watched.set(key, entry);
  }
  if (viewer?.isValid) {
    const r = viewer.getRotation();
    entry.viewers.set(viewer.id, { player: viewer, pitch: r.x, yaw: r.y });
  }
  start();
}

/**
 * Watches every hopper/dispenser/dropper inside a small box. Meant for boxes of a few hundred blocks
 * at most (a piston's moved blocks, the area around one dropped item), never for scanning the world.
 * The box is clamped to the dimension's build height.
 */
export function watchMonitoredIn(dimension: Dimension, min: Vector3, max: Vector3, ticks = WATCH_DURATION_TICKS): void {
  const range = dimension.heightRange;
  const y0 = Math.max(Math.floor(min.y), range.min);
  const y1 = Math.min(Math.floor(max.y), range.max - 1);
  for (let x = Math.floor(min.x); x <= Math.floor(max.x); x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = Math.floor(min.z); z <= Math.floor(max.z); z++) {
        try {
          const block = dimension.getBlock({ x, y, z });
          if (block !== undefined && MONITORED_BLOCK_IDS.has(block.typeId))
            watchBlock(dimension, block.location, ticks);
        } catch {
          // unloaded chunk: nothing to watch there
        }
      }
    }
  }
}
