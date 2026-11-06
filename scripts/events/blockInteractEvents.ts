import {
  world,
  type PlayerInteractWithBlockAfterEvent,
  type PlayerInteractWithBlockBeforeEvent,
} from "@minecraft/server";
import { createHub } from "./eventHub";

/**
 * The ONE place that subscribes to player-interacts-with-block.
 *   onBlockInteract(handler)        after-event  (the click already happened; mutations are allowed)
 *   onBlockInteractBefore(handler)  before-event (restricted execution: only read and set event.cancel,
 *                                   defer everything else with system.run)
 * Both return a function that removes the handler again.
 */
export const onBlockInteract = createHub<PlayerInteractWithBlockAfterEvent>(
  world.afterEvents.playerInteractWithBlock,
  "block_interact"
);

export const onBlockInteractBefore = createHub<PlayerInteractWithBlockBeforeEvent>(
  world.beforeEvents.playerInteractWithBlock,
  "block_interact_before"
);
