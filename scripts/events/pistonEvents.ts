import { world, type PistonActivateAfterEvent } from "@minecraft/server";
import { createHub } from "./eventHub";

/** The ONE pistonActivate subscription (after-event). Returns a function that removes the handler. */
export const onPistonActivate = createHub<PistonActivateAfterEvent>(world.afterEvents.pistonActivate, "piston");
