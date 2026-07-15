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

// Lets players type a literal \n in the command bar to force a line break.
// (You can't type a real newline into a slash command, so this is the
// standard workaround every /item-style addon uses.)
function withNewlines(text: string): string {
  return text.replace(/\\n/g, "\n");
}

// ---- registration (runs immediately when this file is imported) ----------

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand(
    {
      name: "bus:item",
      description: "Edit the name and lore of the item you're holding.",
      permissionLevel: CommandPermissionLevel.GameDirectors, // requires op / cheats
      cheatsRequired: true,
      optionalParameters: [
        { name: "name", type: CustomCommandParamType.String },
        { name: "lore", type: CustomCommandParamType.String },
      ],
    },
    (origin, name, lore) => {
      const player = origin.sourceEntity;
      if (!player || player.typeId !== "minecraft:player") {
        return {
          status: CustomCommandStatus.Failure,
          message: "This command must be run by a player.",
        };
      }

      // Custom command callbacks run in a "before event" / restricted context,
      // so item mutation + sendMessage need to happen a tick later.
      system.run(() => applyItemChanges(player as Player, name, lore));

      return { status: CustomCommandStatus.Success };
    },
  );
});

function applyItemChanges(player: Player, name?: string, lore?: string): void {
  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  const item = equippable?.getEquipment(EquipmentSlot.Mainhand);

  if (!item) {
    player.sendMessage("§cYou need to be holding an item.");
    return;
  }

  if (name !== undefined) {
    item.nameTag = withNewlines(name);
  }

  if (lore !== undefined) {
    // ";" separates lore lines, "\n" forces a break inside one line
    const loreLines = lore.split(";").map((line) => withNewlines(line));
    item.setLore(loreLines);
  }

  equippable!.setEquipment(EquipmentSlot.Mainhand, item);
  player.sendMessage("§aItem updated.");
}
