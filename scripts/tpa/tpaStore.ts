import { world, type Player } from "@minecraft/server";

export type TpaKind = "tpa" | "tpahere";

export interface TpaRequest {
  fromId: string;
  toId: string;
  kind: TpaKind;
  /** system.runTimeout handle for the expiry. */
  timer: number;
}

// Open requests live in memory only (they expire in about a minute, so nothing is worth saving).
// One open request per sender: sending a new one replaces the old one.
const outgoing = new Map<string, TpaRequest>();

export function setRequest(req: TpaRequest): TpaRequest | undefined {
  const old = outgoing.get(req.fromId);
  outgoing.set(req.fromId, req);
  return old;
}

export function getOutgoing(fromId: string): TpaRequest | undefined {
  return outgoing.get(fromId);
}

export function removeRequest(req: TpaRequest): void {
  if (outgoing.get(req.fromId) === req) outgoing.delete(req.fromId);
}

/** Requests waiting for this player, oldest first. */
export function getIncoming(toId: string): TpaRequest[] {
  return [...outgoing.values()].filter((r) => r.toId === toId);
}

export function findPlayerById(id: string): Player | undefined {
  return world.getAllPlayers().find((p) => p.id === id);
}

// ---- per-player privacy (saved on the player, so it survives restarts) ---------------------------
const OFF_KEY = "bus:tpa_off";
const BLOCKED_KEY = "bus:tpa_blocked";
export const MAX_BLOCKED = 50;

interface Blocked {
  id: string;
  name: string;
}

export function isAcceptingRequests(player: Player): boolean {
  return player.getDynamicProperty(OFF_KEY) !== true;
}

export function setAcceptingRequests(player: Player, on: boolean): void {
  player.setDynamicProperty(OFF_KEY, on ? undefined : true);
}

function readBlocked(player: Player): Blocked[] {
  const raw = player.getDynamicProperty(BLOCKED_KEY);
  if (typeof raw !== "string") return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((b): b is Blocked => typeof b?.id === "string" && typeof b?.name === "string")
      : [];
  } catch {
    return [];
  }
}

export function hasBlocked(owner: Player, other: Player): boolean {
  return readBlocked(owner).some((b) => b.id === other.id);
}

/** Blocks or unblocks `other` for `owner`. Returns "blocked", "unblocked" or "full". */
export function toggleBlocked(owner: Player, other: Player): "blocked" | "unblocked" | "full" {
  const list = readBlocked(owner);
  const i = list.findIndex((b) => b.id === other.id);
  if (i >= 0) {
    list.splice(i, 1);
    owner.setDynamicProperty(BLOCKED_KEY, JSON.stringify(list));
    return "unblocked";
  }
  if (list.length >= MAX_BLOCKED) return "full";
  list.push({ id: other.id, name: other.name });
  owner.setDynamicProperty(BLOCKED_KEY, JSON.stringify(list));
  return "blocked";
}
