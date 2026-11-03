import {
  CustomCommandParamType,
  CustomCommandStatus,
  EntityComponentTypes,
  EquipmentSlot,
  Player,
  system,
} from "@minecraft/server";
import { defineBusCommand } from "./busCommand";
import { reply } from "../core/commandResult";
import { t, tell } from "../core/lang";

// /bus:item <name|lore> "<text>"
//   name -> renames the item in your main hand
//   lore -> sets its lore; ";" starts a new lore line
//   Both accept \\n for a line break inside the text (see withNewlines).

const FIELD_ENUM = "bus:item_field";

// The command parser only understands \" and \\ as escapes inside quotes, so a single \n loses its
// backslash before it reaches the script. Typing \\n survives as a literal "\n", which is turned
// into a real line break here.
function withNewlines(text: string): string {
  return text.replace(/\\+n/g, "\n");
}

function getMainhandSlot(player: Player) {
  return player.getComponent(EntityComponentTypes.Equippable)?.getEquipmentSlot(EquipmentSlot.Mainhand);
}

defineBusCommand({
  name: "bus:item",
  description: "bus.command.item.description",
  enums: { [FIELD_ENUM]: ["name", "lore"] },
  mandatoryParameters: [
    { name: FIELD_ENUM, type: CustomCommandParamType.Enum },
    { name: "value", type: CustomCommandParamType.String },
  ],
  permission: { label: t("bus.perm.item_command.name") },
  run: (origin, field: string, value: string) => {
    const player = origin.sourceEntity;
    if (!(player instanceof Player)) {
      return reply(origin, CustomCommandStatus.Failure, "bus.command.players_only", "Only players can use this.");
    }

    // Reading is allowed here, so a missing item is reported as the command's own reply.
    if (!getMainhandSlot(player)?.hasItem()) {
      return reply(origin, CustomCommandStatus.Failure, "bus.command.item.no_item", "Hold an item first.");
    }

    // Changing the item is not allowed in a command callback, so it is applied a tick later.
    system.run(() => {
      try {
        if (!player.isValid) return;
        // Look the slot up again: the player may have swapped items during that tick.
        const slot = getMainhandSlot(player);
        if (!slot?.hasItem()) {
          tell(player, t("bus.command.item.no_item"));
          return;
        }
        if (field === "name") {
          slot.nameTag = withNewlines(value);
        } else {
          slot.setLore(value.split(";").map(withNewlines));
        }
      } catch (e) {
        console.warn(`[bus:item] could not apply ${field}: ${e}`);
        tell(player, t("bus.command.item.invalid"));
      }
    });

    return field === "name"
      ? reply(origin, CustomCommandStatus.Success, "bus.command.item.name_done", "Name updated.")
      : reply(origin, CustomCommandStatus.Success, "bus.command.item.lore_done", "Lore updated.");
  },
});
