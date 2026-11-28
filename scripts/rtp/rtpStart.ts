import { Player, world } from "@minecraft/server";
import { t, tell } from "../core/lang";
import { canUse } from "../permissions/permissionStore";
import { beginTeleport } from "../teleport/teleportService";
import { getRtp, type RtpRange } from "./rtpStore";
import { findSafeLocation } from "./rtpSearch";

/** Starts a random teleport with the chosen dimension and range. Call inside system.run. */
export function startRtp(player: Player, permissionKey: string, dimensionId: string, range: RtpRange): void {
  // Re-check at the moment of use (the picker may have been open for a while).
  if (!canUse(player, permissionKey)) {
    tell(player, t("bus.command.no_permission"));
    return;
  }
  beginTeleport({
    kind: "rtp",
    mover: player,
    resolve: async () => {
      const s = getRtp();
      const dimension = world.getDimension(dimensionId);
      const center = s.center === "player" ? player.location : { x: 0, y: 0, z: 0 };
      const spot = await findSafeLocation(dimension, center, range.min, range.max, s.attempts);
      return spot ? { dimension, location: spot } : undefined;
    },
    onArrived: (mover) => {
      const seconds = getRtp().protection;
      if (seconds > 0) mover.addEffect("resistance", seconds * 20, { amplifier: 4, showParticles: false });
    },
  });
}
