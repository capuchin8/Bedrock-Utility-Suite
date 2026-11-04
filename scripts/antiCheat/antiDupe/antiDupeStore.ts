import { world } from "@minecraft/server";

/**
 * Anti dupe on/off + staff alerts on/off, stored as one world dynamic property.
 * Default: both on (the module worked that way before it had a switch).
 */
const KEY = "bus:anti_dupe";

interface State {
  enabled: boolean;
  alerts: boolean;
}

let state: State | undefined;
const listeners: ((enabled: boolean) => void)[] = [];

function load(): State {
  if (state) return state;
  const loaded: State = { enabled: true, alerts: true };
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw === "string") {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const p = parsed as Record<string, unknown>;
        if (typeof p.enabled === "boolean") loaded.enabled = p.enabled;
        if (typeof p.alerts === "boolean") loaded.alerts = p.alerts;
      }
    }
  } catch {
    // unreadable value: keep the defaults
  }
  state = loaded;
  return loaded;
}

function save(): void {
  world.setDynamicProperty(KEY, JSON.stringify(load()));
}

export const isAntiDupeEnabled = (): boolean => load().enabled;
export const areAntiDupeAlertsEnabled = (): boolean => load().alerts;

export function setAntiDupeEnabled(enabled: boolean): void {
  const s = load();
  if (s.enabled === enabled) return;
  s.enabled = enabled;
  save();
  for (const listener of listeners) listener(enabled);
}

export function setAntiDupeAlerts(alerts: boolean): void {
  load().alerts = alerts;
  save();
}

/** Called whenever the module is switched on or off (events subscribe/unsubscribe in response). */
export function onAntiDupeToggled(listener: (enabled: boolean) => void): void {
  listeners.push(listener);
}
