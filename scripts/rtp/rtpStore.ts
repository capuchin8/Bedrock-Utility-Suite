import { DimensionTypes } from "@minecraft/server";
import type { UIRawMessage } from "@minecraft/server-ui";
import { raw, t } from "../core/lang";
import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";
import { registerShareable } from "../share/shareRegistry";

const KEY = "bus:rtp_settings";

export const MAX_RANGES = 8;
export const MAX_RANGE_BLOCKS = 30_000_000;
export const RTP_LIMITS = { attempts: { min: 1, max: 20 }, protection: { min: 0, max: 60 } } as const;

export interface RtpRange {
  id: string;
  name: string;
  /** Closest distance from the center, in blocks. */
  min: number;
  /** Farthest distance from the center, in blocks. */
  max: number;
}

export interface RtpSettings {
  /** Dimension ids players may be sent to. */
  dimensions: string[];
  ranges: RtpRange[];
  /** origin = world 0,0; player = where the player is standing. */
  center: "origin" | "player";
  /** How many random spots are tried before giving up. */
  attempts: number;
  /** Seconds of damage resistance after arriving (0 = none). */
  protection: number;
}

export const DEFAULT_RTP: RtpSettings = {
  dimensions: ["minecraft:overworld"],
  ranges: [{ id: "default", name: "Default", min: 100, max: 5000 }],
  center: "origin",
  attempts: 8,
  protection: 5,
};

function int(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

export function normalizeRtp(v: unknown): RtpSettings | undefined {
  if (!isRecord(v)) return undefined;
  const d = DEFAULT_RTP;
  const dimensions = Array.isArray(v.dimensions)
    ? [...new Set(v.dimensions.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, 32)
    : d.dimensions;
  const ranges: RtpRange[] = [];
  const seen = new Set<string>();
  if (Array.isArray(v.ranges)) {
    for (const r of v.ranges) {
      if (!isRecord(r) || ranges.length >= MAX_RANGES) continue;
      const id = typeof r.id === "string" && r.id.length > 0 && r.id.length <= 16 ? r.id : `r${ranges.length + 1}`;
      if (seen.has(id)) continue;
      seen.add(id);
      ranges.push({
        id,
        name: typeof r.name === "string" ? r.name.slice(0, 24) : "",
        min: int(r.min, 0, MAX_RANGE_BLOCKS, 0),
        max: int(r.max, 0, MAX_RANGE_BLOCKS, 1000),
      });
    }
  }
  return {
    dimensions,
    ranges: ranges.length > 0 ? ranges : d.ranges,
    center: v.center === "player" ? "player" : "origin",
    attempts: int(v.attempts, RTP_LIMITS.attempts.min, RTP_LIMITS.attempts.max, d.attempts),
    protection: int(v.protection, RTP_LIMITS.protection.min, RTP_LIMITS.protection.max, d.protection),
  };
}

export function getRtp(): RtpSettings {
  return normalizeRtp(readWorldJson<unknown>(KEY, {})) ?? DEFAULT_RTP;
}

export function setRtp(patch: Partial<RtpSettings>): void {
  const next = normalizeRtp({ ...getRtp(), ...patch });
  if (next) writeWorldJson(KEY, next);
}

export function toggleDimension(id: string, on: boolean): void {
  const cur = getRtp().dimensions.filter((d) => d !== id);
  setRtp({ dimensions: on ? [...cur, id] : cur });
}

/** Adds a range and returns its id (undefined at the limit). */
export function addRange(): string | undefined {
  const s = getRtp();
  if (s.ranges.length >= MAX_RANGES) return undefined;
  let n = s.ranges.length + 1;
  while (s.ranges.some((r) => r.id === `r${n}`)) n++;
  const id = `r${n}`;
  setRtp({ ranges: [...s.ranges, { id, name: "", min: 100, max: 5000 }] });
  return id;
}

export function updateRange(id: string, patch: Partial<Omit<RtpRange, "id">>): void {
  setRtp({ ranges: getRtp().ranges.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
}

/** Removes a range (the last one can't be removed). */
export function removeRange(id: string): void {
  const s = getRtp();
  if (s.ranges.length <= 1) return;
  setRtp({ ranges: s.ranges.filter((r) => r.id !== id) });
}

/** Every dimension that exists in this world right now (includes the BUS void dimensions). */
export function listWorldDimensions(): string[] {
  try {
    return DimensionTypes.getAll().map((d) => d.typeId);
  } catch {
    return ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
  }
}

/** The enabled dimensions that still exist (a void dimension turned off in pack settings drops out). */
export function getEnabledDimensions(): string[] {
  const exists = new Set(listWorldDimensions());
  return getRtp().dimensions.filter((d) => exists.has(d));
}

const KNOWN: Record<string, string> = {
  "minecraft:overworld": "bus.rtp.dim.overworld",
  "minecraft:nether": "bus.rtp.dim.nether",
  "minecraft:the_end": "bus.rtp.dim.the_end",
};

export function dimensionLabel(id: string): UIRawMessage {
  return KNOWN[id] ? t(KNOWN[id]) : raw(id);
}

/** "Name (100 - 5000)" or just "100 - 5000" when the range has no name. */
export function rangeLabel(r: RtpRange): UIRawMessage {
  const [lo, hi] = [Math.min(r.min, r.max), Math.max(r.min, r.max)];
  return raw(r.name ? `${r.name} (${lo} - ${hi})` : `${lo} - ${hi}`);
}

registerShareable({
  id: "bus:rtp",
  label: t("bus.share.rtp"),
  export: () => getRtp(),
  import: (data) => {
    const next = normalizeRtp(data);
    if (!next) return t("bus.share.error.generic");
    writeWorldJson(KEY, next);
    return undefined;
  },
});
