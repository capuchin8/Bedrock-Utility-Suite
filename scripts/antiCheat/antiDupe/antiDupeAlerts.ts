import { system, world } from "@minecraft/server";
import { t, tell } from "../../core/lang";
import { canUse, registerPermission } from "../../permissions/permissionStore";
import { ALERT_COOLDOWN_TICKS } from "./antiDupeConfig";
import { areAntiDupeAlertsEnabled } from "./antiDupeStore";

/** Who receives the chat alerts. Owner always, operators by default; the owner can grant it to roles. */
export const ANTI_DUPE_ALERT_KEY = "bus:anti_dupe_alerts";

registerPermission({
  key: ANTI_DUPE_ALERT_KEY,
  label: t("bus.perm.anti_dupe_alerts.name"),
  description: t("bus.perm.anti_dupe_alerts.desc"),
  category: "feature",
  defaultEveryone: false,
  defaultOperators: true,
});

const lastAlert = new Map<string, number>();

const ALERT_KEYS: Record<string, string> = {
  "minecraft:hopper": "bus.anti_dupe.alert.hopper",
  "minecraft:dropper": "bus.anti_dupe.alert.dropper",
  "minecraft:dispenser": "bus.anti_dupe.alert.dispenser",
};

/** Chat message for staff: a bundle was removed from a hopper/dropper/dispenser at this position. */
export function alertStaffBundleRemoved(blockTypeId: string, x: number, y: number, z: number): void {
  if (!areAntiDupeAlertsEnabled()) return;
  const key = ALERT_KEYS[blockTypeId];
  if (key === undefined) return;

  // One alert per block per cooldown: a bundle that is ejected and re-collected counts as one detection.
  const now = system.currentTick;
  for (const [k, tick] of lastAlert) if (now - tick >= ALERT_COOLDOWN_TICKS) lastAlert.delete(k);
  const alertKey = `${blockTypeId}|${x}|${y}|${z}`;
  if (lastAlert.has(alertKey)) return;
  lastAlert.set(alertKey, now);
  const message = t(key, String(x), String(y), String(z));
  for (const player of world.getAllPlayers()) {
    if (canUse(player, ANTI_DUPE_ALERT_KEY)) tell(player, message);
  }
}
