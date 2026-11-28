import { CustomCommandParamType, CustomCommandStatus, Player, system, type CustomCommandOrigin, type CustomCommandResult } from "@minecraft/server";
import { defineBusCommand } from "../commands/busCommand";
import { reply } from "../core/commandResult";
import { checkTeleport, denialResult } from "../teleport/teleportService";
import { filterVisible } from "../vanish/visibility";
import { acceptRequest, cancelOutgoing, denyRequest, pickIncoming, requestBlockedReason, sendRequest } from "./tpaFlow";
import { openIncomingPicker, openPlayerPicker } from "./tpaPicker";
import { getIncoming, type TpaKind } from "./tpaStore";

const FAIL = CustomCommandStatus.Failure;
const OK: CustomCommandResult = { status: CustomCommandStatus.Success };
const PLAYER_PARAM = { name: "player", type: CustomCommandParamType.PlayerSelector } as const;

type Resolved = { player: Player; target?: Player } | { result: CustomCommandResult };

/** Source must be a player; an optional selector must resolve to exactly one player that source can see. */
function resolve(origin: CustomCommandOrigin, targets?: Player[]): Resolved {
  const player = origin.sourceEntity;
  if (!(player instanceof Player)) {
    return { result: reply(origin, FAIL, "bus.command.players_only", "Only players can use this.") };
  }
  if (targets === undefined) return { player };
  const visible = filterVisible(player, targets);
  if (visible.length === 0) return { result: reply(origin, FAIL, "bus.tpa.no_player", "No matching player found.") };
  if (visible.length > 1) return { result: reply(origin, FAIL, "bus.tpa.one_player", "Pick exactly one player.") };
  return { player, target: visible[0] };
}

function defineRequest(name: string, kind: TpaKind): void {
  defineBusCommand({
    name: `bus:${name}`,
    description: `bus.command.${name}.description`,
    optionalParameters: [PLAYER_PARAM],
    permission: { defaultEveryone: true },
    run: (origin, targets?: Player[]) => {
      const r = resolve(origin, targets);
      if ("result" in r) return r.result;
      const { player, target } = r;

      const denied = checkTeleport("tpa", player);
      if (denied) return denialResult(origin, denied);

      if (!target) {
        // No name typed: list the players this person may see.
        system.run(() => openPlayerPicker(player, "bus.tpa.picker.title", (picked) => system.run(() => sendRequest(player, picked, kind))));
        return OK;
      }
      const reason = requestBlockedReason(player, target, kind);
      if (reason) return reply(origin, FAIL, reason, "You can't send that request.");
      system.run(() => sendRequest(player, target, kind));
      return OK;
    },
  });
}

defineRequest("tpa", "tpa");
defineRequest("tpahere", "tpahere");

defineBusCommand({
  name: "bus:tpaccept",
  description: "bus.command.tpaccept.description",
  optionalParameters: [PLAYER_PARAM],
  permission: { defaultEveryone: true },
  run: (origin, targets?: Player[]) => {
    const r = resolve(origin, targets);
    if ("result" in r) return r.result;
    const { player, target } = r;
    const waiting = getIncoming(player.id);
    if (waiting.length === 0) return reply(origin, FAIL, "bus.tpa.none", "You have no teleport requests.");
    if (!target && waiting.length > 1) {
      system.run(() => openIncomingPicker(player, "bus.tpa.accept.title", (req) => system.run(() => acceptRequest(player, req))));
      return OK;
    }
    const req = pickIncoming(player, target);
    if (!req) return reply(origin, FAIL, "bus.tpa.none_from", "That player hasn't sent you a request.");
    system.run(() => acceptRequest(player, req));
    return OK;
  },
});

defineBusCommand({
  name: "bus:tpdeny",
  description: "bus.command.tpdeny.description",
  optionalParameters: [PLAYER_PARAM],
  permission: { defaultEveryone: true },
  run: (origin, targets?: Player[]) => {
    const r = resolve(origin, targets);
    if ("result" in r) return r.result;
    const { player, target } = r;
    const req = pickIncoming(player, target);
    if (!req) return reply(origin, FAIL, target ? "bus.tpa.none_from" : "bus.tpa.none", "You have no matching teleport request.");
    system.run(() => denyRequest(player, req));
    return OK;
  },
});

defineBusCommand({
  name: "bus:tpcancel",
  description: "bus.command.tpcancel.description",
  permission: { defaultEveryone: true },
  run: (origin) => {
    const r = resolve(origin);
    if ("result" in r) return r.result;
    const { player } = r;
    system.run(() => {
      cancelOutgoing(player);
    });
    return OK;
  },
});
