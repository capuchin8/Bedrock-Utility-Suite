import { CustomCommandParamType, CustomCommandStatus, system, type Entity } from "@minecraft/server";
import { defineBusCommand } from "./busCommand";
import { reply } from "../core/commandResult";
import { t } from "../core/lang";

// /bus:impulse <targets> <location> [add]
//   Location accepts ~ and ^ notation, but it resolves to a world POSITION, not a vector, so the
//   source's own position is subtracted to recover the push:
//     ~ ~1.5 ~  -> straight up        ^ ^ ^5  -> 5 blocks the way the source is facing
//     0 1.5 0   -> aims at that exact world coordinate
//   Default is to SET velocity (clear, then push); add:true stacks it on the current velocity.
defineBusCommand({
  name: "bus:impulse",
  description: "bus.command.impulse.description",
  mandatoryParameters: [
    { name: "targets", type: CustomCommandParamType.EntitySelector },
    { name: "location", type: CustomCommandParamType.Location },
  ],
  optionalParameters: [{ name: "add", type: CustomCommandParamType.Boolean }],
  permission: { label: t("bus.perm.impulse_command.name") },
  run: (origin, targets: Entity[], location: { x: number; y: number; z: number }, add?: boolean) => {
    const entities = targets.filter((e) => e.isValid);
    if (entities.length === 0) {
      return reply(origin, CustomCommandStatus.Failure, "bus.command.impulse.not_found", "No matching entities found.");
    }

    // Origin of the ~ / ^ maths: the entity running the command, or the command block.
    const base = origin.sourceEntity?.location ?? origin.sourceBlock?.location ?? { x: 0, y: 0, z: 0 };
    const vector = { x: location.x - base.x, y: location.y - base.y, z: location.z - base.z };

    // Velocity changes are not allowed in a command callback, so they are applied a tick later.
    system.run(() => {
      for (const entity of entities) {
        if (!entity.isValid) continue;
        if (!add) entity.clearVelocity();
        entity.applyImpulse(vector);
      }
    });

    return reply(origin, CustomCommandStatus.Success, "bus.command.impulse.done", "Impulse applied.");
  },
});
