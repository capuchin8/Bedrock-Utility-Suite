import { getChatSend, type ChatEvent } from "../roles/chatSupport";

// The ONE place that subscribes to world.beforeEvents.chatSend (pre-release; reached through
// roles/chatSupport.ts so the add-on still loads without Beta APIs). Features register a handler
// with an order; handlers run lowest order first and the first one that returns true stops the chain.
// Handlers run in a before-event: only read state and set event.cancel here, and defer every
// send/mutation with system.run.
//   10  mute            (swallows messages from muted players)
//   20  staff chat      (routes toggled staff messages to staff only)
//  100  role formatting (the normal chat line)

export type ChatHandler = (event: ChatEvent) => boolean | void;

const handlers: { order: number; run: ChatHandler }[] = [];
let subscribed = false;

export function onChat(order: number, run: ChatHandler): void {
  handlers.push({ order, run });
  handlers.sort((a, b) => a.order - b.order);
  if (subscribed) return;
  const signal = getChatSend();
  if (!signal) return;
  subscribed = true;
  signal.subscribe((event) => {
    for (const handler of handlers) {
      try {
        if (handler.run(event) === true) return;
      } catch (e) {
        console.warn(`[bus:chat] handler failed: ${e}`);
      }
    }
  });
}
