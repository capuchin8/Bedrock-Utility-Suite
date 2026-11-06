import { world, type EntitySpawnAfterEvent } from "@minecraft/server";
import { createHub } from "./eventHub";

/** The ONE entitySpawn subscription (after-event). Returns a function that removes the handler. */
export const onEntitySpawn = createHub<EntitySpawnAfterEvent>(world.afterEvents.entitySpawn, "entity_spawn");
