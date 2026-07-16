import {
  system,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  EquipmentSlot,
  EntityComponentTypes,
  Player,
} from "@minecraft/server";

// ---- helpers ----------------------------------------------------------

// The chat/command parser only recognizes \" and \\ as escapes inside a
// quoted string - anything else after a backslash (like \n) isn't
// recognized, so the parser just drops the backslash and leaves a bare
// "n" behind. That single-backslash version can't be recovered here.
//
// Typing \\n (two backslashes) survives instead: \\ IS a recognized
// escape and collapses to one literal backslash, so \\n arrives here as
// an actual "\n" (backslash + n) which this then turns into a real
// line break.
function withNewlines(text: string): string {
  return text.replace(/\\+n/g, "\n");
}

// ---- registration (runs immediately when this file is imported) ----------

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerEnum("bus:itemField", ["name", "lore"]);

  customCommandRegistry.registerCommand(
    {
      name: "bus:item",
      description:
        "Set the name or lore of the item you're holding. Use ';' to separate lore lines, and '\\\\n' to force a line break inside one line.",
      permissionLevel: CommandPermissionLevel.GameDirectors, // requires op / cheats
      cheatsRequired: true,
      mandatoryParameters: [
        { name: "bus:itemField", type: CustomCommandParamType.Enum },
        { name: "value", type: CustomCommandParamType.String },
      ],
    },
    (origin, field, value) => {
      const player = origin.sourceEntity;
      if (!player || player.typeId !== "minecraft:player") {
        return {
          status: CustomCommandStatus.Failure,
          message: "This command must be run by a player.",
        };
      }

      // Custom command callbacks run in a "before event" / restricted context,
      // so item mutation + sendMessage need to happen a tick later.
      system.run(() => applyItemChange(player as Player, field as "name" | "lore", value));

      return { status: CustomCommandStatus.Success };
    }
  );
});

function applyItemChange(player: Player, field: "name" | "lore", value: string): void {
  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  const item = equippable?.getEquipment(EquipmentSlot.Mainhand);

  if (!item) {
    player.sendMessage("§cYou need to be holding an item.");
    return;
  }

  if (field === "name") {
    item.nameTag = withNewlines(value);
  } else {
    // ";" separates lore lines, "\\n" forces a break inside one line
    const loreLines = value.split(";").map((line) => withNewlines(line));
    item.setLore(loreLines);
  }

  equippable!.setEquipment(EquipmentSlot.Mainhand, item);
  player.sendMessage(`§a${field === "name" ? "Name" : "Lore"} updated.`);
}
