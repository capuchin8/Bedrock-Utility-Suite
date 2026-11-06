/**
 * Shared helper for "one real subscription, many handlers". A hub subscribes to its event signal when
 * the first handler is added and unsubscribes when the last one is removed, so nothing listens unless
 * a module actually uses it. Used by blockInteractEvents, pistonEvents and entitySpawnEvents.
 */
export interface Signal<E> {
  subscribe(callback: (event: E) => void): (event: E) => void;
  unsubscribe(callback: (event: E) => void): void;
}

/** Returns `add(handler)`, which returns a function that removes the handler again. */
export function createHub<E>(signal: Signal<E>, name: string): (handler: (event: E) => void) => () => void {
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
