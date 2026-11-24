import { world, type Player } from "@minecraft/server";
import { t } from "../core/lang";
import { getNickname } from "../nicknames/nicknameStore";
import { canUse, registerPermission } from "../permissions/permissionStore";
import { stripFormatting } from "../roles/display";
import { isVanished } from "./vanishStore";

// Reusable "who can this person see?" helpers for any command or menu that lists players.
//
//   const players = getVisiblePlayers(viewer);                  // vanished players removed for non-staff
//   const rows    = getVisibleEntries(viewer);                  // [{ player, label }] label = nickname for non-staff
//   const targets = filterVisible(viewer, selectorResult);      // for PlayerSelector results
//   const player  = findVisiblePlayer(viewer, typedText);       // typed name / nickname -> player
//
// Staff = anyone with the bus:vanish_see permission (the owner always has it). A viewer of undefined
// (console, command block) counts as staff. Staff see real names; everyone else sees nicknames.
//
// Why helpers and not a custom enum: command enums are registered once at startup with fixed values and
// are the same for every viewer, so they can't change per viewer or follow players joining, leaving or
// vanishing. A PlayerSelector plus filterVisible is the live equivalent.

export const VANISH_SEE_KEY = "bus:vanish_see";

registerPermission({
  key: VANISH_SEE_KEY,
  label: t("bus.perm.vanish_see.name"),
  description: t("bus.perm.vanish_see.desc"),
  category: "feature",
  defaultEveryone: false,
  defaultOperators: true,
});

export function canSeeVanished(viewer?: Player): boolean {
  return !viewer || canUse(viewer, VANISH_SEE_KEY);
}

/** true if `target` should be invisible to `viewer` in lists and name lookups. */
export function isHiddenFrom(viewer: Player | undefined, target: Player): boolean {
  return isVanished(target) && target.id !== viewer?.id && !canSeeVanished(viewer);
}

export function filterVisible<T extends Player>(viewer: Player | undefined, players: readonly T[]): T[] {
  if (canSeeVanished(viewer)) return [...players];
  return players.filter((p) => !isHiddenFrom(viewer, p));
}

export function getVisiblePlayers(viewer?: Player): Player[] {
  return filterVisible(viewer, world.getAllPlayers());
}

/** The name `viewer` should see for `target`: real name for staff, nickname (else name) for everyone else. */
export function getVisibleName(viewer: Player | undefined, target: Player): string {
  if (canSeeVanished(viewer)) return target.name;
  return getNickname(target) ?? target.name;
}

export interface VisibleEntry {
  player: Player;
  label: string;
}

export function getVisibleEntries(viewer?: Player): VisibleEntry[] {
  return getVisiblePlayers(viewer).map((player) => ({ player, label: getVisibleName(viewer, player) }));
}

/** Looks a typed name up among the players `viewer` can see (colour codes and case are ignored). */
export function findVisiblePlayer(viewer: Player | undefined, text: string): Player | undefined {
  const wanted = stripFormatting(text).trim().toLowerCase();
  if (!wanted) return undefined;
  return getVisibleEntries(viewer).find((e) => stripFormatting(e.label).toLowerCase() === wanted)?.player;
}
