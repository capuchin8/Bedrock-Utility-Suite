import {
  system,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Entity,
} from "@minecraft/server";

// ---- registration (runs immediately when this file is imported) ----------

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand(
    {
      name: "bus:impulse",
      description:
        "Set (or add to) the velocity of one or more entities. Supports ~ and ^ notation.",
      permissionLevel: CommandPermissionLevel.GameDirectors, // requires op / cheats
      cheatsRequired: true,
      mandatoryParameters: [
        { name: "targets", type: CustomCommandParamType.EntitySelector },
        { name: "location", type: CustomCommandParamType.Location },
      ],
      optionalParameters: [
        { name: "add", type: CustomCommandParamType.Boolean },
      ],
    },
    (origin, targets, location, add) => {
      const entities = targets as Entity[];
      const source = origin.sourceEntity;

      if (entities.length === 0) {
        return {
          status: CustomCommandStatus.Failure,
          message: "No matching entities found.",
        };
      }

      // The Location parameter resolves ~ / ^ / absolute notation into an
      // ABSOLUTE world position based on the source's position + facing -
      // it's a point, not a vector. Subtracting the source's own position
      // back out recovers the actual delta the player meant:
      //   ~ ~1.5 ~   -> same as the old plain "0 1.5 0" (straight up)
      //   ^ ^ ^5     -> 5 blocks in whatever direction the source is facing
      //   0 1.5 0    -> aims the impulse at that exact world coordinate
      //                 (only equivalent to "straight up 1.5" if the
      //                 source happens to be standing at x=0, z=0)
      const basePosition = source ? source.location : { x: 0, y: 0, z: 0 };
      const vector = {
        x: location.x - basePosition.x,
        y: location.y - basePosition.y,
        z: location.z - basePosition.z,
      };

      system.run(() => {
        for (const entity of entities) {
          if (!entity.isValid) continue;

          // By default this SETS velocity exactly (clear first, then push);
          // pass add:true to stack the impulse on top of existing velocity instead.
          if (!add) {
            entity.clearVelocity();
          }
          entity.applyImpulse(vector);
        }
      });

      return { status: CustomCommandStatus.Success };
    },
  );
});
