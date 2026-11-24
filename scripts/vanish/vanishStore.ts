import { world, type Player } from "@minecraft/server";
import { t } from "../core/lang";
import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";
import { registerShareable } from "../share/shareRegistry";

const SETTINGS_KEY = "bus:vanish_settings";
const IDS_KEY = "bus:vanish_ids"; // world property: JSON array of player ids that are vanished (online or not)
/** Player dynamic property: true while vanished. This is the source of truth for one player. */
export const VANISHED_PROP = "bus:vanished";
/** Player dynamic property: the game mode to go back to when the spectator setting moved them. */
export const PREV_MODE_PROP = "bus:vanish_prev_mode";

export const MAX_FORMAT_LENGTH = 128;
// Real names by default: the vanilla join/leave messages always use real names, so nicknames would look out of place.
export const DEFAULT_JOIN_FORMAT = "&e{realname} joined the game";
export const DEFAULT_LEAVE_FORMAT = "&e{realname} left the game";
export const DEFAULT_MAP_HEAD_ITEM = "minecraft:skeleton_skull";

export interface VanishSettings {
  /** Send a fake leave message when vanishing and a fake join message when revealing. */
  fakeMessages: boolean;
  /** Tokens: {realname} (the player's real name), {name} (nickname if set). Supports & codes. Blank = send nothing. */
  joinFormat: string;
  leaveFormat: string;
  /** Turn the locator bar off while exactly one non-vanished player is online and someone is vanished. */
  adjustLocatorBar: boolean;
  /** Put the player in spectator mode while vanished (previous mode is restored). */
  spectator: boolean;
  /** Vanished players see a particle where other vanished players are. */
  particles: boolean;
  /** Action bar reminder for vanished players. */
  reminder: boolean;
  /** Stay vanished after leaving and rejoining. */
  persist: boolean;
  /** Vanished players peek into containers instead of opening them. */
  containerPeek: boolean;
  /** Peeking lets them take and move items (needs the bus:vanish_edit permission). */
  containerEdit: boolean;
  /** Wear a locked head item while vanished so the player's marker doesn't show on maps. */
  hideFromMaps: boolean;
  /** Item id worn on the head for hideFromMaps. */
  mapHeadItem: string;
}

export const DEFAULT_VANISH: VanishSettings = {
  fakeMessages: true,
  joinFormat: DEFAULT_JOIN_FORMAT,
  leaveFormat: DEFAULT_LEAVE_FORMAT,
  adjustLocatorBar: false,
  spectator: false,
  particles: true,
  reminder: true,
  persist: true,
  containerPeek: true,
  containerEdit: true,
  hideFromMaps: false,
  mapHeadItem: DEFAULT_MAP_HEAD_ITEM,
};

export function normalizeVanish(v: unknown): VanishSettings | undefined {
  if (!isRecord(v)) return undefined;
  const d = DEFAULT_VANISH;
  const bool = (x: unknown, fb: boolean): boolean => (typeof x === "boolean" ? x : fb);
  const str = (x: unknown, fb: string): string => (typeof x === "string" ? x.slice(0, MAX_FORMAT_LENGTH) : fb);
  return {
    fakeMessages: bool(v.fakeMessages, d.fakeMessages),
    joinFormat: str(v.joinFormat, d.joinFormat),
    leaveFormat: str(v.leaveFormat, d.leaveFormat),
    adjustLocatorBar: bool(v.adjustLocatorBar, d.adjustLocatorBar),
    spectator: bool(v.spectator, d.spectator),
    particles: bool(v.particles, d.particles),
    reminder: bool(v.reminder, d.reminder),
    persist: bool(v.persist, d.persist),
    containerPeek: bool(v.containerPeek, d.containerPeek),
    containerEdit: bool(v.containerEdit, d.containerEdit),
    hideFromMaps: bool(v.hideFromMaps, d.hideFromMaps),
    mapHeadItem: str(v.mapHeadItem, d.mapHeadItem).trim() || d.mapHeadItem,
  };
}

export function getVanishSettings(): VanishSettings {
  return normalizeVanish(readWorldJson<unknown>(SETTINGS_KEY, {})) ?? DEFAULT_VANISH;
}

// ---- change signals ----------------------------------------------------------------------------
const settingsListeners = new Set<() => void>();
export function onVanishSettingsChanged(listener: () => void): void {
  settingsListeners.add(listener);
}
function notifySettings(): void {
  for (const listener of settingsListeners) listener();
}

export function setVanishSettings(patch: Partial<VanishSettings>): void {
  const next = normalizeVanish({ ...getVanishSettings(), ...patch });
  if (!next) return;
  writeWorldJson(SETTINGS_KEY, next);
  notifySettings();
}

/** Fires after a player is vanished or revealed. Called with no arguments after the saved list loads. */
export type VanishListener = (player?: Player, vanished?: boolean) => void;
const vanishListeners: VanishListener[] = [];
export function onVanishChanged(listener: VanishListener): void {
  vanishListeners.push(listener);
}
export function notifyVanishChanged(player?: Player, vanished?: boolean): void {
  for (const listener of vanishListeners) {
    try {
      listener(player, vanished);
    } catch (e) {
      console.warn(`[bus:vanish] listener failed: ${e}`);
    }
  }
}

// ---- who is vanished ---------------------------------------------------------------------------
export function isVanished(player: Player): boolean {
  try {
    return player.getDynamicProperty(VANISHED_PROP) === true;
  } catch {
    return false;
  }
}

// World properties can't be read while the script loads, so the list is read lazily.
let ids: Set<string> | undefined;
function idSet(): Set<string> {
  if (!ids) {
    const raw = readWorldJson<unknown>(IDS_KEY, []);
    ids = new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  }
  return ids;
}

/** Re-reads the saved list (called once the world has loaded). */
export function loadVanishIds(): void {
  ids = undefined;
  idSet();
}

export function getVanishedIds(): ReadonlySet<string> {
  return idSet();
}

export function setTracked(playerId: string, on: boolean): void {
  const set = idSet();
  if (set.has(playerId) === on) return;
  if (on) set.add(playerId);
  else set.delete(playerId);
  if (set.size === 0) world.setDynamicProperty(IDS_KEY, undefined);
  else writeWorldJson(IDS_KEY, [...set]);
}

registerShareable({
  id: "bus:vanish",
  label: t("bus.share.vanish"),
  export: () => getVanishSettings(),
  import: (data) => {
    const next = normalizeVanish(data);
    if (!next) return t("bus.share.error.generic");
    writeWorldJson(SETTINGS_KEY, next);
    notifySettings();
    return undefined;
  },
});
