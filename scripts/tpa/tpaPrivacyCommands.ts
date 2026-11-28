import { CustomCommandParamType, CustomCommandStatus, Player, system } from "@minecraft/server";
import { defineBusCommand } from "../commands/busCommand";
import { reply } from "../core/commandResult";
import { t, tell } from "../core/lang";
import { filterVisible, getVisibleName } from "../vanish/visibility";
import { isAcceptingRequests, setAcceptingRequests, toggleBlocked } from "./tpaStore";

// /bus:tptoggle turns incoming requests on or off. /bus:tpblock <player> blocks or unblocks one player.

defineBusCommand({
  name: "bus:tptoggle",
  description: "bus.command.tptoggle.description",
  permission: { defaultEveryone: true },
  run: (origin) => {
    const player = origin.sourceEntity;
    if (!(player instanceof Player)) {
      return reply(origin, CustomCommandStatus.Failure, "bus.command.players_only", "Only players can use this.");
    }
    const nowOn = !isAcceptingRequests(player);
    system.run(() => setAcceptingRequests(player, nowOn));
    return reply(
      origin,
      CustomCommandStatus.Success,
      nowOn ? "bus.tpa.toggle.on" : "bus.tpa.toggle.off",
      nowOn ? "Teleport requests are now ON." : "Teleport requests are now OFF."
    );
  },
});

defineBusCommand({
  name: "bus:tpblock",
  description: "bus.command.tpblock.description",
  mandatoryParameters: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
  permission: { defaultEveryone: true },
  run: (origin, targets: Player[]) => {
    const player = origin.sourceEntity;
    if (!(player instanceof Player)) {
      return reply(origin, CustomCommandStatus.Failure, "bus.command.players_only", "Only players can use this.");
    }
    const visible = filterVisible(player, targets).filter((p) => p.id !== player.id);
    if (visible.length !== 1) {
      return reply(origin, CustomCommandStatus.Failure, "bus.tpa.one_player", "Pick exactly one other player.");
    }
    const target = visible[0];
    system.run(() => {
      const result = toggleBlocked(player, target);
      const name = getVisibleName(player, target);
      tell(player, t(result === "blocked" ? "bus.tpa.block.added" : result === "unblocked" ? "bus.tpa.block.removed" : "bus.tpa.block.full", name));
    });
    return { status: CustomCommandStatus.Success };
  },
});
