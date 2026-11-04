import type { Player } from "@minecraft/server";
import type { RawMessage } from "@minecraft/server";

/**
 * Anti cheat modules (anti dupe, and anything added later) register themselves here and show up as
 * buttons on Settings > Anti cheat. Each module opens its own screen; `back` returns to the hub.
 */
export interface AntiCheatModule {
  id: string; // e.g. "bus:anti_dupe"
  title: RawMessage;
  order: number; // lower = earlier
  open: (player: Player, back: () => void) => void;
}

const modules: AntiCheatModule[] = [];

export function registerAntiCheatModule(module: AntiCheatModule): void {
  if (modules.some((m) => m.id === module.id)) return;
  modules.push(module);
  modules.sort((a, b) => a.order - b.order);
}

export const getAntiCheatModules = (): readonly AntiCheatModule[] => modules;
