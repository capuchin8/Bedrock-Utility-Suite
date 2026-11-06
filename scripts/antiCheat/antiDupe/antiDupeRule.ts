import { system } from "@minecraft/server";
import { isRuleActive, onAntiDupeChanged, type AntiDupeRule } from "./antiDupeStore";

/**
 * Defines one anti dupe rule. `start` runs (and subscribes to whatever the rule needs) only while the
 * master switch and the rule's own switch are on; `stop` must undo everything `start` did.
 * The saved setting is read after the world is ready, and changes made in Settings apply immediately.
 */
export function defineAntiDupeRule(id: AntiDupeRule, hooks: { start: () => void; stop: () => void }): void {
  let running = false;
  const sync = (): void => {
    const want = isRuleActive(id);
    if (want === running) return;
    running = want;
    if (want) hooks.start();
    else hooks.stop();
  };
  onAntiDupeChanged(() => system.run(sync));
  system.run(sync);
}
