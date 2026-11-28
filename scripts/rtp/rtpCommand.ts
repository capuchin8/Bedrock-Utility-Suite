import { CustomCommandStatus, Player, system } from "@minecraft/server";
import { defineBusCommand } from "../commands/busCommand";
import { reply } from "../core/commandResult";
import { checkTeleport, denialResult } from "../teleport/teleportService";
import { openRtpPicker } from "./rtpPicker";
import { startRtp } from "./rtpStart";
import { getEnabledDimensions, getRtp } from "./rtpStore";

// /bus:wild and /bus:rtp do exactly the same thing. The owner keeps whichever one they like by setting
// the other's "Command Permission Level" pack setting to Disabled (needs a world reload). Each command
// has its own permission key, so the Permissions screen shows which one is disabled.

for (const name of ["wild", "rtp"]) {
  const key = `bus:${name}`;
  defineBusCommand({
    name: key,
    description: "bus.command.rtp.description",
    permission: { defaultEveryone: true },
    run: (origin) => {
      const player = origin.sourceEntity;
      if (!(player instanceof Player)) {
        return reply(origin, CustomCommandStatus.Failure, "bus.command.players_only", "Only players can use this.");
      }
      const dimensions = getEnabledDimensions();
      if (dimensions.length === 0) {
        return reply(origin, CustomCommandStatus.Failure, "bus.rtp.no_dimensions", "No dimensions are enabled for random teleport.");
      }
      const denied = checkTeleport("rtp", player);
      if (denied) return denialResult(origin, denied);

      const ranges = getRtp().ranges;
      system.run(() => {
        // One dimension and one range: nothing to ask, go straight to the warm-up.
        if (dimensions.length === 1 && ranges.length === 1) startRtp(player, key, dimensions[0], ranges[0]);
        else openRtpPicker(player, key, dimensions);
      });
      return { status: CustomCommandStatus.Success };
    },
  });
}
