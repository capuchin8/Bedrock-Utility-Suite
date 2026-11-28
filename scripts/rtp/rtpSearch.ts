import { system, world, type Block, type Dimension, type Vector3 } from "@minecraft/server";

// Finds a safe standing spot. Each attempt loads one chunk with a temporary ticking area (the chunk
// must be loaded to read blocks), checks the ground, and removes the area again.
// Unverified in game: TickingAreaManager is in the 2.12.0-beta typings; chunk limits are per pack.

const UNSAFE = new Set([
  "minecraft:cactus",
  "minecraft:magma",
  "minecraft:fire",
  "minecraft:soul_fire",
  "minecraft:campfire",
  "minecraft:soul_campfire",
  "minecraft:sweet_berry_bush",
  "minecraft:powder_snow",
  "minecraft:wither_rose",
  "minecraft:bedrock",
  "minecraft:lava",
  "minecraft:flowing_lava",
  "minecraft:water",
  "minecraft:flowing_water",
]);

let counter = 0;

function solidGround(b: Block | undefined): b is Block {
  if (!b || b.isAir || b.isLiquid) return false;
  if (UNSAFE.has(b.typeId) || b.typeId.endsWith("_leaves")) return false;
  return true;
}

function roomAbove(b: Block): boolean {
  const a1 = b.above(1);
  const a2 = b.above(2);
  return !!a1 && !!a2 && a1.isAir && a2.isAir;
}

function groundAt(dim: Dimension, x: number, z: number): Vector3 | undefined {
  const { min, max } = dim.heightRange;
  if (dim.id === "minecraft:nether") {
    // The nether has a bedrock roof: scan down from below it for a floor with two free blocks above.
    for (let y = Math.min(120, max - 8); y > min + 1; y--) {
      const b = dim.getBlock({ x, y, z });
      if (solidGround(b) && roomAbove(b)) return { x: x + 0.5, y: y + 1, z: z + 0.5 };
    }
    return undefined;
  }
  const top = dim.getTopmostBlock({ x, z });
  if (solidGround(top) && roomAbove(top)) return { x: x + 0.5, y: top.y + 1, z: z + 0.5 };
  return undefined;
}

function randomPoint(center: Vector3, min: number, max: number): { x: number; z: number } {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  // Uniform over the ring between lo and hi.
  const r = Math.sqrt(Math.random() * (hi * hi - lo * lo) + lo * lo);
  const a = Math.random() * Math.PI * 2;
  return { x: Math.floor(center.x + r * Math.cos(a)), z: Math.floor(center.z + r * Math.sin(a)) };
}

export async function findSafeLocation(
  dim: Dimension,
  center: Vector3,
  min: number,
  max: number,
  attempts: number
): Promise<Vector3 | undefined> {
  const manager = world.tickingAreaManager;
  for (let i = 0; i < attempts; i++) {
    const p = randomPoint(center, min, max);
    const id = `bus:rtp_${system.currentTick}_${counter++}`;
    const options = {
      dimension: dim,
      from: { x: p.x, y: dim.heightRange.min, z: p.z },
      to: { x: p.x, y: dim.heightRange.min, z: p.z },
    };
    try {
      if (!manager.hasCapacity(options)) {
        await waitTicks(10);
        continue;
      }
      await manager.createTickingArea(id, options);
      const spot = groundAt(dim, p.x, p.z);
      if (spot) return spot;
    } catch (e) {
      console.warn(`[bus:rtp] attempt failed: ${e}`);
    } finally {
      try {
        if (manager.hasTickingArea(id)) manager.removeTickingArea(id);
      } catch {
        // already gone
      }
    }
  }
  return undefined;
}

function waitTicks(n: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(resolve, n));
}
