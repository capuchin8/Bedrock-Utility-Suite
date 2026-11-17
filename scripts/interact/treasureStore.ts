import { Player, world, type Entity } from "@minecraft/server";
import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";

// Treasure containers: a chest/barrel/etc. (or an entity with an inventory, like a chest minecart)
// that gives its contents to each player once.
//  - Blocks are stored in one world JSON keyed by block position (same key as interactive blocks).
//  - Entities carry their treasure as a dynamic property on the entity itself, so it follows the
//    entity and disappears with it (same idea as entityLinks.ts).
//  - Who has claimed what is stored on the PLAYER (bus:treasure_claims), so it works for offline
//    players too. A treasure has a `version`; "reset claims" just raises it.

const BLOCKS_KEY = "bus:treasures";
const DEFAULTS_KEY = "bus:treasure_defaults";
const ENTITY_PROP = "bus:treasure";
const CLAIMS_PROP = "bus:treasure_claims";

export const MAX_TREASURES = 100;
const MAX_JSON_LENGTH = 30000;
const MAX_CLAIMS_PER_PLAYER = 200;
const MAX_NAME = 40;
const MAX_SOUND = 64;

export interface TreasureDefaults {
  /** Empty = the translated "Treasure". */
  name: string;
  /** Bedrock sound id. Empty or "none" = silent. */
  openSound: string;
  errorSound: string;
  /** Cancel players breaking a treasure block. */
  protect: boolean;
}

/** Optional fields override the defaults for this one treasure (undefined = use the default). */
export interface Treasure {
  id: string;
  /** Block or entity type when it was set up (a replaced block drops its treasure). */
  type: string;
  /** Raised by "reset claims": everyone can claim again. */
  version: number;
  name?: string;
  openSound?: string;
  errorSound?: string;
  protect?: boolean;
}

export type TreasureRef = { kind: "block"; key: string } | { kind: "entity"; entity: Entity };

export const FACTORY_DEFAULTS: TreasureDefaults = {
  name: "",
  openSound: "random.levelup",
  errorSound: "mob.villager.no",
  protect: true,
};

const cleanName = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, MAX_NAME) : "");
const cleanSound = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, "").slice(0, MAX_SOUND) : "");

/** Name for buttons and logs: colour codes removed (button text can't render them). */
export function plainName(name: string): string {
  return name.replace(/[&§][0-9a-vr]/gi, "");
}

/** Name for chat and labels: & codes turned into section codes. */
export function colorName(name: string): string {
  return name.replace(/&([0-9a-vr])/gi, "§$1");
}

// ---- defaults ---------------------------------------------------------------------------------
export function normalizeDefaults(v: unknown): TreasureDefaults | undefined {
  if (!isRecord(v)) return undefined;
  return {
    name: cleanName(v.name),
    openSound: typeof v.openSound === "string" ? cleanSound(v.openSound) : FACTORY_DEFAULTS.openSound,
    errorSound: typeof v.errorSound === "string" ? cleanSound(v.errorSound) : FACTORY_DEFAULTS.errorSound,
    protect: typeof v.protect === "boolean" ? v.protect : FACTORY_DEFAULTS.protect,
  };
}

export function getDefaults(): TreasureDefaults {
  return normalizeDefaults(readWorldJson<unknown>(DEFAULTS_KEY, {})) ?? { ...FACTORY_DEFAULTS };
}

export function setDefaults(patch: Partial<TreasureDefaults>): void {
  const next = normalizeDefaults({ ...getDefaults(), ...patch });
  if (next) writeWorldJson(DEFAULTS_KEY, next);
}

/** What a treasure actually uses: its own setting, else the default. */
export function effectiveSettings(treasure: Treasure): TreasureDefaults {
  const d = getDefaults();
  return {
    name: treasure.name || d.name,
    openSound: treasure.openSound || d.openSound,
    errorSound: treasure.errorSound || d.errorSound,
    protect: treasure.protect ?? d.protect,
  };
}

// ---- treasures --------------------------------------------------------------------------------
function newId(): string {
  return `t${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newTreasure(type: string): Treasure {
  return { id: newId(), type, version: 0 };
}

export function normalizeTreasure(v: unknown): Treasure | undefined {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.type !== "string") return undefined;
  const out: Treasure = {
    id: v.id.slice(0, 32),
    type: v.type,
    version: typeof v.version === "number" && v.version >= 0 ? Math.floor(v.version) : 0,
  };
  const name = cleanName(v.name);
  if (name) out.name = name;
  const open = cleanSound(v.openSound);
  if (open) out.openSound = open;
  const error = cleanSound(v.errorSound);
  if (error) out.errorSound = error;
  if (typeof v.protect === "boolean") out.protect = v.protect;
  return out;
}

// ---- blocks -----------------------------------------------------------------------------------
function readBlocks(): Record<string, Treasure> {
  const raw = readWorldJson<unknown>(BLOCKS_KEY, {});
  const out: Record<string, Treasure> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const treasure = normalizeTreasure(value);
    if (treasure) out[key] = treasure;
  }
  return out;
}

export function listBlockTreasures(): [string, Treasure][] {
  return Object.entries(readBlocks());
}

export function getBlockTreasure(key: string): Treasure | undefined {
  return readBlocks()[key];
}

/** Returns false if the list is full or the data would be too large. */
export function saveBlockTreasure(key: string, treasure: Treasure): boolean {
  const all = readBlocks();
  if (!(key in all) && Object.keys(all).length >= MAX_TREASURES) return false;
  const clean = normalizeTreasure(treasure);
  if (!clean) return false;
  all[key] = clean;
  const json = JSON.stringify(all);
  if (json.length > MAX_JSON_LENGTH) return false;
  writeWorldJson(BLOCKS_KEY, all);
  return true;
}

export function removeBlockTreasure(key: string): void {
  const all = readBlocks();
  if (!(key in all)) return;
  delete all[key];
  writeWorldJson(BLOCKS_KEY, all);
}

// ---- entities ---------------------------------------------------------------------------------
const DIMENSIONS = ["overworld", "nether", "the_end"];
const SKIP_TYPES = ["minecraft:player", "minecraft:item", "minecraft:xp_orb"];

export function getEntityTreasure(entity: Entity): Treasure | undefined {
  try {
    const raw = entity.getDynamicProperty(ENTITY_PROP);
    if (typeof raw !== "string") return undefined;
    return normalizeTreasure(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** Mutation: not allowed in before-events (wrap in system.run there). */
export function setEntityTreasure(entity: Entity, treasure: Treasure): boolean {
  const clean = normalizeTreasure(treasure);
  if (!clean) return false;
  entity.setDynamicProperty(ENTITY_PROP, JSON.stringify(clean));
  return true;
}

export function clearEntityTreasure(entity: Entity): void {
  entity.setDynamicProperty(ENTITY_PROP, undefined);
}

/** Treasure entities in loaded chunks only. Run on demand (when a menu opens), never per tick. */
export function listTreasureEntities(): { entity: Entity; treasure: Treasure }[] {
  const out: { entity: Entity; treasure: Treasure }[] = [];
  for (const id of DIMENSIONS) {
    try {
      for (const entity of world.getDimension(id).getEntities({ excludeTypes: SKIP_TYPES })) {
        const treasure = getEntityTreasure(entity);
        if (treasure) out.push({ entity, treasure });
      }
    } catch {
      // dimension unavailable
    }
  }
  return out;
}

// ---- one interface for both -------------------------------------------------------------------
export function readTreasure(ref: TreasureRef): Treasure | undefined {
  if (ref.kind === "block") return getBlockTreasure(ref.key);
  return ref.entity.isValid ? getEntityTreasure(ref.entity) : undefined;
}

export function writeTreasure(ref: TreasureRef, treasure: Treasure): boolean {
  if (ref.kind === "block") return saveBlockTreasure(ref.key, treasure);
  return ref.entity.isValid ? setEntityTreasure(ref.entity, treasure) : false;
}

export function deleteTreasure(ref: TreasureRef): void {
  if (ref.kind === "block") removeBlockTreasure(ref.key);
  else if (ref.entity.isValid) clearEntityTreasure(ref.entity);
}

/** Changes some fields of a stored treasure (a field set to undefined goes back to "use the default"). */
export function patchTreasure(ref: TreasureRef, patch: Partial<Omit<Treasure, "id" | "type" | "version">>): boolean {
  const current = readTreasure(ref);
  if (!current) return false;
  return writeTreasure(ref, { ...current, ...patch });
}

/** Everyone can claim this treasure again. */
export function resetClaims(ref: TreasureRef): boolean {
  const current = readTreasure(ref);
  if (!current) return false;
  return writeTreasure(ref, { ...current, version: current.version + 1 });
}

// ---- claims (stored on the player) ------------------------------------------------------------
function readClaims(player: Player): Record<string, number> {
  try {
    const raw = player.getDynamicProperty(CLAIMS_PROP);
    if (typeof raw !== "string") return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, version] of Object.entries(parsed)) if (typeof version === "number") out[id] = version;
    return out;
  } catch {
    return {};
  }
}

export function hasClaimed(player: Player, treasure: Treasure): boolean {
  return readClaims(player)[treasure.id] === treasure.version;
}

/** Mutation: not allowed in before-events. Keeps only the most recent claims so the property stays small. */
export function markClaimed(player: Player, treasure: Treasure): void {
  const claims = readClaims(player);
  delete claims[treasure.id]; // re-insert at the end so the oldest entries are the ones dropped
  claims[treasure.id] = treasure.version;
  const entries = Object.entries(claims);
  const kept = entries.slice(Math.max(0, entries.length - MAX_CLAIMS_PER_PLAYER));
  player.setDynamicProperty(CLAIMS_PROP, JSON.stringify(Object.fromEntries(kept)));
}
