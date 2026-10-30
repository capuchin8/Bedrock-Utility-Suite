import { world, type Entity } from "@minecraft/server";
import { normalizeAction, type BlockAction } from "./interactStore";

// An entity's link (what right-clicking it does) is stored ON the entity as a dynamic property, so it
// follows the entity: it survives reloads, and disappears with the entity when it dies. There is no
// separate list to go stale.
const PROP = "bus:interact_action";
const DIMENSIONS = ["overworld", "nether", "the_end"];
const SKIP_TYPES = ["minecraft:player", "minecraft:item", "minecraft:xp_orb"];

export function getEntityAction(entity: Entity): BlockAction | undefined {
  try {
    const raw = entity.getDynamicProperty(PROP);
    if (typeof raw !== "string") return undefined;
    return normalizeAction(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** Mutation: not allowed in before-events (wrap in system.run there). */
export function setEntityAction(entity: Entity, action: Omit<BlockAction, "type">): boolean {
  const clean = normalizeAction({ ...action, type: entity.typeId });
  if (!clean) return false;
  entity.setDynamicProperty(PROP, JSON.stringify(clean));
  return true;
}

export function clearEntityAction(entity: Entity): void {
  entity.setDynamicProperty(PROP, undefined);
}

/** Linked entities in loaded chunks (an unloaded entity can't be seen until its chunk loads). Only run on demand, e.g. when a menu opens. */
export function listLinkedEntities(): { entity: Entity; action: BlockAction }[] {
  const out: { entity: Entity; action: BlockAction }[] = [];
  for (const id of DIMENSIONS) {
    try {
      for (const entity of world.getDimension(id).getEntities({ excludeTypes: SKIP_TYPES })) {
        const action = getEntityAction(entity);
        if (action) out.push({ entity, action });
      }
    } catch {
      // dimension unavailable
    }
  }
  return out;
}
