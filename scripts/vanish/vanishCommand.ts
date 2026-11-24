import {
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  type CustomCommandOrigin,
} from "@minecraft/server";
import { defineBusCommand } from "../commands/busCommand";
import { reply } from "../core/commandResult";
import { t, tell } from "../core/lang";
import { canUse, registerPermission } from "../permissions/permissionStore";
import { setVanish } from "./vanishService";
import { isVanished } from "./vanishStore";

// /bus:vanish [target] [enabled]   and its shortcut   /bus:v [target] [enabled]
//   no args          -> toggles vanish for yourself
//   target           -> toggles it for those players (needs bus:vanish_others)
//   target + enabled -> forces on/off (use @s as the target to force it on yourself)
// The API has no command aliases, so /bus:v is its own command that shares the same permission key.

const VANISH_KEY = "bus:vanish";
const VANISH_OTHERS_KEY = "bus:vanish_others";

registerPermission({
  key: VANISH_OTHERS_KEY,
  label: t("bus.perm.vanish_others.name"),
  description: t("bus.perm.vanish_others.desc"),
  category: "feature",
  defaultEveryone: false,
});

function toggle(origin: CustomCommandOrigin, targets?: Player[], enabled?: boolean) {
  const fail = (key: string, fallback: string) => reply(origin, CustomCommandStatus.Failure, key, fallback);
  const source = origin.sourceEntity instanceof Player ? origin.sourceEntity : undefined;

  let players: Player[];
  if (targets === undefined) {
    if (!source) return fail("bus.command.vanish.need_target", "Specify a target.");
    players = [source];
  } else {
    players = targets.filter((p) => p.isValid);
  }
  if (players.length === 0) return fail("bus.command.vanish.not_found", "No matching player found.");
  if (source && players.some((p) => p.id !== source.id) && !canUse(source, VANISH_OTHERS_KEY)) {
    return fail("bus.command.vanish.others_denied", "You can't vanish other players.");
  }

  // Work out the result now (reading is allowed here); apply it a tick later.
  const plan = players.map((player) => ({ player, next: enabled ?? !isVanished(player) }));
  system.run(() => {
    for (const { player, next } of plan) {
      if (!setVanish(player, next)) continue;
      if (player.id !== source?.id) tell(player, t(next ? "bus.vanish.notify_on" : "bus.vanish.notify_off"));
    }
  });

  if (plan.length > 1)
    return reply(origin, CustomCommandStatus.Success, "bus.command.vanish.updated", "Vanish updated.");
  return reply(
    origin,
    CustomCommandStatus.Success,
    plan[0].next ? "bus.command.vanish.on" : "bus.command.vanish.off",
    plan[0].next ? "Vanish enabled." : "Vanish disabled."
  );
}

function define(name: string): void {
  defineBusCommand({
    name,
    description: "bus.command.vanish.description",
    optionalParameters: [
      { name: "target", type: CustomCommandParamType.PlayerSelector },
      { name: "enabled", type: CustomCommandParamType.Boolean },
    ],
    permission: { key: VANISH_KEY, label: t("bus.perm.vanish_command.name") },
    run: (origin, targets?: Player[], enabled?: boolean) => toggle(origin, targets, enabled),
  });
}

define("bus:vanish");
define("bus:v");
