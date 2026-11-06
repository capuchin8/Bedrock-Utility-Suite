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

const BUNDLE_ALERT_KEYS: Record<string, string> = {
  "minecraft:hopper": "bus.anti_dupe.alert.hopper",
  "minecraft:dropper": "bus.anti_dupe.alert.dropper",
  "minecraft:dispenser": "bus.anti_dupe.alert.dispenser",
};

/**
 * Chat message for staff with a lang key whose three %s are x, y, z.
 * One alert per key and position per cooldown, so one detection that fires twice reads as one.
 */
export function alertStaff(langKey: string, x: number, y: number, z: number): void {
  if (!areAntiDupeAlertsEnabled()) return;

  const now = system.currentTick;
  for (const [k, tick] of lastAlert) if (now - tick >= ALERT_COOLDOWN_TICKS) lastAlert.delete(k);
  const dedupe = `${langKey}|${Math.floor(x)}|${Math.floor(y)}|${Math.floor(z)}`;
  if (lastAlert.has(dedupe)) return;
  lastAlert.set(dedupe, now);

  const message = t(langKey, String(Math.floor(x)), String(Math.floor(y)), String(Math.floor(z)));
  for (const player of world.getAllPlayers()) {
    if (canUse(player, ANTI_DUPE_ALERT_KEY)) tell(player, message);
  }
}

/** A bundle was removed from a hopper/dropper/dispenser. */
export function alertStaffBundleRemoved(blockTypeId: string, x: number, y: number, z: number): void {
  const key = BUNDLE_ALERT_KEYS[blockTypeId];
  if (key !== undefined) alertStaff(key, x, y, z);
}
