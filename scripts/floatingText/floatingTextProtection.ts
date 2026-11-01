import { DimensionTypes, system, world, type Entity } from "@minecraft/server";
import { isGod, setGod } from "../utils/godMode";

/**
 * Keeps floating text and floating scoreboards invincible through the god mode module
 * (utils/godMode.ts), so nothing can hurt or /kill them.
 *
 *  - New ones are protected when they are created (protectFloating, called by the menu).
 *  - Ones that were created before this existed are protected when they load, and once when the
 *    world finishes loading for the chunks that are already loaded.
 *  - Ones that are deleted on purpose go through removeFloatingEntity, which switches god mode
 *    off first so the module's list of protected ids doesn't fill up with deleted entities.
 */
const ENTITY_ID = "bus:floatingtext";

/** Puts one floating entity in god mode. Call outside restricted execution (wrap in system.run). */
export function protectFloating(entity: Entity): void {
  if (!entity.isValid || isGod(entity)) return;
  try {
    setGod(entity, true);
  } catch (e) {
    console.warn(`[bus:floatingtext] could not protect an entity: ${e}`);
  }
}

/** Deletes a floating entity that is meant to go away, releasing its god mode first. */
export function removeFloatingEntity(entity: Entity): void {
  if (!entity.isValid) return;
  try {
    if (isGod(entity)) setGod(entity, false);
  } catch (e) {
    console.warn(`[bus:floatingtext] could not release an entity: ${e}`);
  }
  if (entity.isValid) entity.remove();
}

// Entities from before this existed (and any that unloaded and loaded again).
world.afterEvents.entityLoad.subscribe(({ entity }) => {
  if (entity.typeId !== ENTITY_ID) return;
  system.run(() => protectFloating(entity));
});

// The chunks around players may already be loaded when scripts start, and those don't fire entityLoad.
world.afterEvents.worldLoad.subscribe(() => {
  system.run(() => {
    for (const type of DimensionTypes.getAll()) {
      try {
        for (const entity of world.getDimension(type.typeId).getEntities({ type: ENTITY_ID })) protectFloating(entity);
      } catch {
        // dimension not available
      }
    }
  });
});
