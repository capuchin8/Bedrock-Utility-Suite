import { t } from "../core/lang";
import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";
import { registerShareable } from "../share/shareRegistry";

// Shared rules for every "move a player somewhere" feature. RTP and TPA read their cooldown, warm-up,
// combat rule and price from here, and any future teleport feature (homes, warps...) can do the same by
// adding a kind to TeleportKind and calling beginTeleport() from teleportService.ts.

const KEY = "bus:teleport_settings";

export type TeleportKind = "rtp" | "tpa";
export const TELEPORT_KINDS: readonly TeleportKind[] = ["rtp", "tpa"];

export const TELEPORT_LIMITS = {
  cooldown: { min: 0, max: 86_400 },
  warmup: { min: 0, max: 120 },
  cost: { min: 0, max: 2_000_000_000 },
  tpaTimeout: { min: 10, max: 600 },
} as const;

export interface TeleportRules {
  /** Seconds before the same player can use this kind again (0 = none). */
  cooldown: number;
  /** Seconds the player must wait, standing still, before the teleport happens (0 = instant). */
  warmup: number;
  /** false = blocked while the player is in combat (see Settings > Combat). */
  allowInCombat: boolean;
  /** Price in the shop currency, charged only when the teleport actually happens (0 = free). */
  cost: number;
}

export interface TeleportSettings {
  rules: Record<TeleportKind, TeleportRules>;
  /** Moving during the warm-up cancels it. */
  cancelOnMove: boolean;
  /** Taking damage during the warm-up cancels it. */
  cancelOnDamage: boolean;
  /** Countdown ticks and arrival sound. */
  sounds: boolean;
  /** Seconds a /bus:tpa request stays open. */
  tpaTimeout: number;
  /** Allow /bus:tpahere. */
  tpaAllowHere: boolean;
}

export const DEFAULT_TELEPORT: TeleportSettings = {
  rules: {
    rtp: { cooldown: 60, warmup: 3, allowInCombat: false, cost: 0 },
    tpa: { cooldown: 10, warmup: 3, allowInCombat: false, cost: 0 },
  },
  cancelOnMove: true,
  cancelOnDamage: true,
  sounds: true,
  tpaTimeout: 60,
  tpaAllowHere: true,
};

function int(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

function normalizeRules(v: unknown, d: TeleportRules): TeleportRules {
  const r = isRecord(v) ? v : {};
  return {
    cooldown: int(r.cooldown, TELEPORT_LIMITS.cooldown.min, TELEPORT_LIMITS.cooldown.max, d.cooldown),
    warmup: int(r.warmup, TELEPORT_LIMITS.warmup.min, TELEPORT_LIMITS.warmup.max, d.warmup),
    allowInCombat: typeof r.allowInCombat === "boolean" ? r.allowInCombat : d.allowInCombat,
    cost: int(r.cost, TELEPORT_LIMITS.cost.min, TELEPORT_LIMITS.cost.max, d.cost),
  };
}

export function normalizeTeleport(v: unknown): TeleportSettings | undefined {
  if (!isRecord(v)) return undefined;
  const d = DEFAULT_TELEPORT;
  const rules = isRecord(v.rules) ? v.rules : {};
  const bool = (x: unknown, fb: boolean): boolean => (typeof x === "boolean" ? x : fb);
  return {
    rules: { rtp: normalizeRules(rules.rtp, d.rules.rtp), tpa: normalizeRules(rules.tpa, d.rules.tpa) },
    cancelOnMove: bool(v.cancelOnMove, d.cancelOnMove),
    cancelOnDamage: bool(v.cancelOnDamage, d.cancelOnDamage),
    sounds: bool(v.sounds, d.sounds),
    tpaTimeout: int(v.tpaTimeout, TELEPORT_LIMITS.tpaTimeout.min, TELEPORT_LIMITS.tpaTimeout.max, d.tpaTimeout),
    tpaAllowHere: bool(v.tpaAllowHere, d.tpaAllowHere),
  };
}

export function getTeleportSettings(): TeleportSettings {
  return normalizeTeleport(readWorldJson<unknown>(KEY, {})) ?? DEFAULT_TELEPORT;
}

/** Changes the shared (non-rules) settings. */
export function setTeleportSettings(patch: Partial<Omit<TeleportSettings, "rules">>): void {
  const next = normalizeTeleport({ ...getTeleportSettings(), ...patch });
  if (next) writeWorldJson(KEY, next);
}

/** Changes the rules of one teleport kind. */
export function setTeleportRules(kind: TeleportKind, patch: Partial<TeleportRules>): void {
  const current = getTeleportSettings();
  const next = normalizeTeleport({ ...current, rules: { ...current.rules, [kind]: { ...current.rules[kind], ...patch } } });
  if (next) writeWorldJson(KEY, next);
}

registerShareable({
  id: "bus:teleport",
  label: t("bus.share.teleport"),
  export: () => getTeleportSettings(),
  import: (data) => {
    const next = normalizeTeleport(data);
    if (!next) return t("bus.share.error.generic");
    writeWorldJson(KEY, next);
    return undefined;
  },
});
