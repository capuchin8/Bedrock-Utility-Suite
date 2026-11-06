import type { EntitySpawnAfterEvent } from "@minecraft/server";
import { onEntitySpawn } from "../../events/entitySpawnEvents";
import { isInsideWorld } from "./antiDupeConfig";
import { alertStaff } from "./antiDupeAlerts";
import { defineAntiDupeRule } from "./antiDupeRule";
import { destroyBlock } from "./destroyBlock";

/**
 * Rule "dripleaf": a falling block that spawns on top of a big dripleaf breaks the dripleaf (it drops as
 * an item), so the falling block just falls. A powered leaf keeps the falling blocks stuck on it, and
 * they can be duplicated when the area reloads.
 */

const onSpawn = ({ entity }: EntitySpawnAfterEvent): void => {
  if (!entity.isValid || entity.typeId !== "minecraft:falling_block") return;

  const dim = entity.dimension;
  const x = Math.floor(entity.location.x);
  const y = Math.floor(entity.location.y);
  const z = Math.floor(entity.location.z);
  // the block it spawned in, and the one right under it
  for (const dy of [0, -1]) {
    if (!isInsideWorld(dim, y + dy)) continue;
    try {
      if (dim.getBlock({ x, y: y + dy, z })?.typeId === "minecraft:big_dripleaf") {
        if (destroyBlock(dim, { x, y: y + dy, z })) alertStaff("bus.anti_dupe.alert.dripleaf", x, y + dy, z);
        return;
      }
    } catch {
      // chunk not loaded
    }
  }
};

let remove: (() => void) | undefined;

defineAntiDupeRule("dripleaf", {
  start: () => {
    remove = onEntitySpawn(onSpawn);
  },
  stop: () => {
    remove?.();
    remove = undefined;
  },
});
