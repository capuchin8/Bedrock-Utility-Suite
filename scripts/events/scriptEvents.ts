import { Player, system, type ScriptEventCommandMessageAfterEvent } from "@minecraft/server";

// One place for /scriptevent bus:<name> handlers. The subscription is only made when the first
// handler is registered, so nothing listens unless a module actually uses a script event.
// /scriptevent itself needs game-director level (or a command block / function), so only staff can send these.

export type ScriptEventHandler = (event: ScriptEventCommandMessageAfterEvent) => void;

const handlers = new Map<string, ScriptEventHandler>();
let subscribed = false;

/** Register a handler for "bus:<name>". Call at the top level of a module file. */
export function onScriptEvent(id: string, handler: ScriptEventHandler): void {
  if (!id.startsWith("bus:")) throw new Error(`Script event id must use the bus: namespace ("${id}")`);
  if (handlers.has(id)) throw new Error(`Script event "${id}" is already registered`);
  handlers.set(id, handler);

  if (subscribed) return;
  subscribed = true;
  system.afterEvents.scriptEventReceive.subscribe(
    (event) => {
      const handler = handlers.get(event.id);
      if (!handler) return;
      try {
        handler(event);
      } catch (e) {
        console.warn(`[bus:scriptevent] "${event.id}" failed: ${e}`);
      }
    },
    { namespaces: ["bus"] }
  );
}

/**
 * The player a script event is about: the player who ran it, or the player who started an NPC dialogue.
 * From a command block use /execute as @p run scriptevent ... so a player is the source.
 */
export function scriptEventPlayer(event: ScriptEventCommandMessageAfterEvent): Player | undefined {
  if (event.sourceEntity instanceof Player) return event.sourceEntity;
  if (event.initiator instanceof Player) return event.initiator;
  return undefined;
}
