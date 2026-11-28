import { system, type Player } from "@minecraft/server";
import { t, tell } from "../core/lang";
import { getVisibleName } from "../vanish/visibility";
import { beginTeleport, cancelWarmup, checkTeleport, tellDenial } from "../teleport/teleportService";
import { getTeleportSettings } from "../teleport/teleportSettings";
import {
  findPlayerById,
  getIncoming,
  getOutgoing,
  hasBlocked,
  isAcceptingRequests,
  removeRequest,
  setRequest,
  type TpaKind,
  type TpaRequest,
} from "./tpaStore";

// Every function here mutates or sends messages: call inside system.run from command callbacks.
// Names shown to a player always go through getVisibleName so nicknames and vanish are respected.

/** Why `from` may not send `to` a request, as a lang key (undefined = allowed). */
export function requestBlockedReason(from: Player, to: Player, kind: TpaKind): string | undefined {
  if (from.id === to.id) return "bus.tpa.self";
  if (kind === "tpahere" && !getTeleportSettings().tpaAllowHere) return "bus.tpa.here_disabled";
  // Same message for "off" and "blocked" so nobody can tell they were blocked.
  if (!isAcceptingRequests(to) || hasBlocked(to, from)) return "bus.tpa.not_accepting";
  return undefined;
}

export function sendRequest(from: Player, to: Player, kind: TpaKind): void {
  if (!from.isValid || !to.isValid) return;
  const reason = requestBlockedReason(from, to, kind);
  if (reason) return tell(from, t(reason));
  const denied = checkTeleport("tpa", from);
  if (denied) return tellDenial(denied);

  const timeout = getTeleportSettings().tpaTimeout;
  const req: TpaRequest = {
    fromId: from.id,
    toId: to.id,
    kind,
    timer: system.runTimeout(() => expire(req), timeout * 20),
  };
  const old = setRequest(req);
  if (old) system.clearRun(old.timer);

  tell(from, t("bus.tpa.sent", getVisibleName(from, to)));
  tell(to, t(kind === "tpa" ? "bus.tpa.received" : "bus.tpa.received_here", getVisibleName(to, from)));
}

function expire(req: TpaRequest): void {
  removeRequest(req);
  const from = findPlayerById(req.fromId);
  const to = findPlayerById(req.toId);
  if (from && to) tell(from, t("bus.tpa.expired", getVisibleName(from, to)));
  if (to && from) tell(to, t("bus.tpa.expired_incoming", getVisibleName(to, from)));
}

function drop(req: TpaRequest): void {
  system.clearRun(req.timer);
  removeRequest(req);
}

/** The request a player means: from `senderId` if given, otherwise the newest waiting one. */
export function pickIncoming(to: Player, sender?: Player): TpaRequest | undefined {
  const list = getIncoming(to.id);
  return sender ? list.find((r) => r.fromId === sender.id) : list[list.length - 1];
}

export function acceptRequest(to: Player, req: TpaRequest): void {
  const from = findPlayerById(req.fromId);
  drop(req);
  if (!from || !to.isValid) return tell(to, t("bus.tpa.gone"));

  // tpa: the sender travels to the accepter. tpahere: the accepter travels to the sender.
  const mover = req.kind === "tpa" ? from : to;
  const goal = req.kind === "tpa" ? to : from;
  tell(to, t("bus.tpa.accepted_you", getVisibleName(to, from)));
  tell(from, t("bus.tpa.accepted", getVisibleName(from, to)));

  beginTeleport({
    kind: "tpa",
    mover,
    payer: from,
    resolve: () => (goal.isValid ? { dimension: goal.dimension, location: goal.location } : undefined),
    onCancelled: () => tell(mover.id === from.id ? to : from, t("bus.tpa.cancelled")),
  });
}

export function denyRequest(to: Player, req: TpaRequest): void {
  const from = findPlayerById(req.fromId);
  drop(req);
  tell(to, t("bus.tpa.denied_you"));
  if (from) tell(from, t("bus.tpa.denied", getVisibleName(from, to)));
}

/** Withdraws the sender's open request and any teleport of theirs that is counting down. */
export function cancelOutgoing(from: Player): boolean {
  const req = getOutgoing(from.id);
  let did = false;
  if (req) {
    drop(req);
    const to = findPlayerById(req.toId);
    if (to) tell(to, t("bus.tpa.withdrawn", getVisibleName(to, from)));
    did = true;
  }
  if (cancelWarmup(from, "bus.teleport.cancelled_manual")) did = true;
  return did;
}
