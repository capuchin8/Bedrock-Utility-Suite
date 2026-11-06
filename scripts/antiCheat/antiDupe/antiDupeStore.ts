import { world } from "@minecraft/server";

/**
 * Anti dupe settings, stored as one world dynamic property:
 *  - enabled: master switch for every rule
 *  - alerts:  chat alerts for staff
 *  - rules:   one switch per rule
 * Default: everything on (the bundle rule worked that way before it had a switch).
 */
const KEY = "bus:anti_dupe";

export type AntiDupeRule = "bundle" | "piston" | "chest" | "dripleaf";
export const ANTI_DUPE_RULES: readonly AntiDupeRule[] = ["bundle", "piston", "chest", "dripleaf"];

interface State {
  enabled: boolean;
  alerts: boolean;
  rules: Record<AntiDupeRule, boolean>;
}

let state: State | undefined;
const listeners: (() => void)[] = [];

function load(): State {
  if (state) return state;
  const loaded: State = {
    enabled: true,
    alerts: true,
    rules: { bundle: true, piston: true, chest: true, dripleaf: true },
  };
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw === "string") {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const p = parsed as Record<string, unknown>;
        if (typeof p.enabled === "boolean") loaded.enabled = p.enabled;
        if (typeof p.alerts === "boolean") loaded.alerts = p.alerts;
        if (typeof p.rules === "object" && p.rules !== null) {
          const r = p.rules as Record<string, unknown>;
          for (const rule of ANTI_DUPE_RULES) if (typeof r[rule] === "boolean") loaded.rules[rule] = r[rule];
        }
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

function changed(): void {
  for (const listener of listeners) listener();
}

export const isAntiDupeEnabled = (): boolean => load().enabled;
export const areAntiDupeAlertsEnabled = (): boolean => load().alerts;
export const isRuleEnabled = (rule: AntiDupeRule): boolean => load().rules[rule];
/** A rule runs only while the master switch AND its own switch are on. */
export const isRuleActive = (rule: AntiDupeRule): boolean => load().enabled && load().rules[rule];

export function setAntiDupeEnabled(enabled: boolean): void {
  const s = load();
  if (s.enabled === enabled) return;
  s.enabled = enabled;
  save();
  changed();
}

export function setRuleEnabled(rule: AntiDupeRule, enabled: boolean): void {
  const s = load();
  if (s.rules[rule] === enabled) return;
  s.rules[rule] = enabled;
  save();
  changed();
}

export function setAntiDupeAlerts(alerts: boolean): void {
  load().alerts = alerts;
  save();
}

/** Called whenever the master switch or any rule switch changes. */
export function onAntiDupeChanged(listener: () => void): void {
  listeners.push(listener);
}
