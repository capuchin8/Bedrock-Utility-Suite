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
      description: "Set (or add to) the velocity of one or more entities.",
      permissionLevel: CommandPermissionLevel.GameDirectors, // requires op / cheats
      cheatsRequired: true,
      mandatoryParameters: [
        { name: "targets", type: CustomCommandParamType.EntitySelector },
        { name: "x", type: CustomCommandParamType.Float },
        { name: "y", type: CustomCommandParamType.Float },
        { name: "z", type: CustomCommandParamType.Float },
      ],
      optionalParameters: [
        { name: "add", type: CustomCommandParamType.Boolean },
      ],
    },
    (origin, targets, x, y, z, add) => {
      const entities = targets as Entity[];

      if (entities.length === 0) {
        return {
          status: CustomCommandStatus.Failure,
          message: "No matching entities found.",
        };
      }

      // Custom command callbacks run in a "before event" / restricted context,
      // so velocity changes have to happen a tick later.
      system.run(() => {
        for (const entity of entities) {
          if (!entity.isValid) continue;

          // By default this SETS velocity exactly (clear first, then push);
          // pass add:true to stack the impulse on top of existing velocity instead.
          if (!add) {
            entity.clearVelocity();
          }
          entity.applyImpulse({ x, y, z });
        }
      });

      return { status: CustomCommandStatus.Success };
    },
  );
});
