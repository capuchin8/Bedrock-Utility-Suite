import { CustomCommandParamType, CustomCommandStatus, Player, system, type Entity } from "@minecraft/server";
import { defineBusCommand } from "./busCommand";
import { reply } from "../core/commandResult";
import { t, tell } from "../core/lang";
import { isGod, setGod } from "../utils/godMode";

// /bus:god [target] [enabled]
//   no args          -> toggles god mode for yourself
//   target           -> toggles it for those players or entities (pets, mobs, ...)
//   target + enabled -> forces on/off (use @s as the target to force it on yourself)
defineBusCommand({
  name: "bus:god",
  description: "bus.command.god.description",
  optionalParameters: [
    { name: "target", type: CustomCommandParamType.EntitySelector },
    { name: "enabled", type: CustomCommandParamType.Boolean },
  ],
  permission: { label: t("bus.perm.god_command.name") },
  run: (origin, targets?: Entity[], enabled?: boolean) => {
    const source = origin.sourceEntity;

    let entities: Entity[];
    if (targets === undefined) {
      if (!source)
        return reply(origin, CustomCommandStatus.Failure, "bus.command.god.need_target", "Specify a target.");
      entities = [source];
    } else {
      entities = targets.filter((e) => e.isValid);
    }
    if (entities.length === 0) {
      return reply(origin, CustomCommandStatus.Failure, "bus.command.god.not_found", "No matching entity found.");
    }

    // Work out the result now (reading is allowed here); apply it a tick later.
    const plan = entities.map((e) => ({ entity: e, next: enabled ?? !isGod(e) }));
    system.run(() => {
      for (const { entity, next } of plan) {
        setGod(entity, next);
        if (entity instanceof Player && entity.id !== source?.id) {
          tell(entity, t(next ? "bus.god.notify_on" : "bus.god.notify_off"));
        }
      }
    });

    if (plan.length > 1)
      return reply(origin, CustomCommandStatus.Success, "bus.command.god.updated", "God mode updated.");
    return reply(
      origin,
      CustomCommandStatus.Success,
      plan[0].next ? "bus.command.god.on" : "bus.command.god.off",
      plan[0].next ? "God mode enabled." : "God mode disabled."
    );
  },
});
