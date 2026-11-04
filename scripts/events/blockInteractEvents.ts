import {
  world,
  type PlayerInteractWithBlockAfterEvent,
  type PlayerInteractWithBlockBeforeEvent,
} from "@minecraft/server";

/**
 * The ONE place that subscribes to player-interacts-with-block. Modules register a handler; the real
 * subscription is only made while at least one handler exists (made on the first, removed with the last),
 * so nothing listens unless a module uses it.
 *
 *   onBlockInteract(handler)        after-event  (the click already happened; mutations are allowed)
 *   onBlockInteractBefore(handler)  before-event (restricted execution: only read and set event.cancel,
 *                                   defer everything else with system.run)
 *
 * Both return a function that removes the handler again.
 */

interface Signal<E> {
  subscribe(callback: (event: E) => void): (event: E) => void;
  unsubscribe(callback: (event: E) => void): void;
}

function createHub<E>(signal: Signal<E>, name: string): (handler: (event: E) => void) => () => void {
  const handlers = new Set<(event: E) => void>();
  let subscribed = false;

  const dispatch = (event: E): void => {
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (e) {
        console.warn(`[bus:${name}] handler failed: ${e}`);
      }
    }
  };

  return (handler) => {
    handlers.add(handler);
    if (!subscribed) {
      subscribed = true;
      signal.subscribe(dispatch);
    }
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0 && subscribed) {
        subscribed = false;
        signal.unsubscribe(dispatch);
      }
    };
  };
}

export const onBlockInteract = createHub<PlayerInteractWithBlockAfterEvent>(
  world.afterEvents.playerInteractWithBlock,
  "block_interact"
);

export const onBlockInteractBefore = createHub<PlayerInteractWithBlockBeforeEvent>(
  world.beforeEvents.playerInteractWithBlock,
  "block_interact_before"
);
