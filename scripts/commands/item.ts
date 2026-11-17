import {
  CustomCommandParamType,
  CustomCommandStatus,
  EnchantmentTypes,
  EntityComponentTypes,
  EquipmentSlot,
  ItemStack,
  ItemTypes,
  Player,
  system,
  type Enchantment,
} from "@minecraft/server";
import { defineBusCommand } from "./busCommand";
import { reply } from "../core/commandResult";
import { t, tell } from "../core/lang";

// /bus:item <name|lore|book|give> "<text>" [amount] ["name"] ["lore"]
//   name -> renames the item in your main hand
//   lore -> sets its lore; ";" starts a new lore line
//   Both accept \\n for a line break inside the text (see withNewlines).
//   book -> gives you an enchanted book: "sharpness:5,unbreaking:3" (id:level, comma separated).
//           The "minecraft:" prefix is optional and a missing level means that enchantment's
//           vanilla maximum. Levels above the maximum are rejected (the engine caps them).
//   give -> gives you item(s): /bus:item give diamond_sword 1 "Cool\\nSword" "Line 1;Line 2"
//           The text is the item id ("minecraft:" optional). The optional amount, name and lore must
//           be given in that order (the command system cannot skip an optional parameter). Name and
//           lore use the same \\n and ; rules as above. Stacks are split at the item's stack size.

const FIELD_ENUM = "bus:item_field";
const MAX_GIVE_AMOUNT = 2304; // 36 stacks of 64

// The command parser only understands \" and \\ as escapes inside quotes, so a single \n loses its
// backslash before it reaches the script. Typing \\n survives as a literal "\n", which is turned
// into a real line break here.
function withNewlines(text: string): string {
  return text.replace(/\\+n/g, "\n");
}

function getMainhandSlot(player: Player) {
  return player.getComponent(EntityComponentTypes.Equippable)?.getEquipmentSlot(EquipmentSlot.Mainhand);
}

type BookParse = { ok: true; enchantments: Enchantment[] } | { ok: false; key: string; fallback: string };

/** "sharpness:5, minecraft:unbreaking, mending:1" -> validated enchantments (reading only, safe in a callback). */
function parseBookEnchantments(text: string): BookParse {
  const bad = (key: string, fallback: string): BookParse => ({ ok: false, key, fallback });
  const chosen = new Map<string, Enchantment>();

  for (const entry of text.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;

    // "minecraft:sharpness:5" -> the level is the part after the LAST colon, if that part is a number.
    const lastColon = trimmed.lastIndexOf(":");
    const tail = lastColon === -1 ? "" : trimmed.slice(lastColon + 1);
    const hasLevel = /^\d+$/.test(tail);
    const idPart = (hasLevel ? trimmed.slice(0, lastColon) : trimmed).toLowerCase();
    if (idPart === "") return bad("bus.command.item.book_format", "Use enchantment:level, separated by commas.");

    const type = EnchantmentTypes.get(idPart.includes(":") ? idPart : `minecraft:${idPart}`);
    if (!type) return bad("bus.command.item.book_unknown", "Unknown enchantment.");

    const level = hasLevel ? Number(tail) : type.maxLevel;
    if (level < 1 || level > type.maxLevel) {
      return bad("bus.command.item.book_level", "That level is above the enchantment's maximum.");
    }
    chosen.set(type.id, { type, level });
  }

  if (chosen.size === 0) return bad("bus.command.item.book_format", "Use enchantment:level, separated by commas.");
  return { ok: true, enchantments: [...chosen.values()] };
}

defineBusCommand({
  name: "bus:item",
  description: "bus.command.item.description",
  enums: { [FIELD_ENUM]: ["name", "lore", "book", "give"] },
  mandatoryParameters: [
    { name: FIELD_ENUM, type: CustomCommandParamType.Enum },
    { name: "value", type: CustomCommandParamType.String },
  ],
  optionalParameters: [
    { name: "amount", type: CustomCommandParamType.Integer },
    { name: "itemName", type: CustomCommandParamType.String },
    { name: "itemLore", type: CustomCommandParamType.String },
  ],
  permission: { label: t("bus.perm.item_command.name") },
  run: (origin, field: string, value: string, amount?: number, itemName?: string, itemLore?: string) => {
    const player = origin.sourceEntity;
    if (!(player instanceof Player)) {
      return reply(origin, CustomCommandStatus.Failure, "bus.command.players_only", "Only players can use this.");
    }

    // ---- enchanted book: needs no held item ----
    if (field === "book") {
      const parsed = parseBookEnchantments(value);
      if (!parsed.ok) return reply(origin, CustomCommandStatus.Failure, parsed.key, parsed.fallback);

      // Creating and giving items is not allowed in a command callback, so it happens a tick later.
      system.run(() => {
        try {
          if (!player.isValid) return;
          const book = new ItemStack("minecraft:enchanted_book", 1);
          const enchantable = book.getComponent("minecraft:enchantable");
          if (!enchantable) throw new Error("enchanted_book has no minecraft:enchantable component");
          enchantable.addEnchantments(parsed.enchantments);

          const leftover = player.getComponent(EntityComponentTypes.Inventory)?.container?.addItem(book);
          // Inventory full: drop it at the player's feet instead of losing it.
          if (leftover) player.dimension.spawnItem(leftover, player.location);
        } catch (e) {
          console.warn(`[bus:item] could not create the enchanted book: ${e}`);
          tell(player, t("bus.command.item.book_failed"));
        }
      });
      return reply(origin, CustomCommandStatus.Success, "bus.command.item.book_done", "Enchanted book given.");
    }

    // ---- give: new item(s) with a name / lore already applied ----
    if (field === "give") {
      const id = value.trim().toLowerCase();
      const type = ItemTypes.get(id.includes(":") ? id : `minecraft:${id}`);
      if (!type) return reply(origin, CustomCommandStatus.Failure, "bus.command.item.give_unknown", "Unknown item.");
      const total = amount ?? 1;
      if (total < 1 || total > MAX_GIVE_AMOUNT) {
        return reply(
          origin,
          CustomCommandStatus.Failure,
          "bus.command.item.give_amount",
          "Amount must be between 1 and 2304."
        );
      }

      system.run(() => {
        try {
          if (!player.isValid) return;
          const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
          let remaining = total;
          while (remaining > 0) {
            const stack = new ItemStack(type, 1);
            const count = Math.min(remaining, stack.maxAmount);
            stack.amount = count;
            if (itemName !== undefined && itemName !== "") stack.nameTag = withNewlines(itemName);
            if (itemLore !== undefined && itemLore !== "") stack.setLore(itemLore.split(";").map(withNewlines));
            const leftover = container?.addItem(stack);
            // Inventory full: drop the rest at the player's feet instead of losing it.
            if (leftover) player.dimension.spawnItem(leftover, player.location);
            remaining -= count;
          }
        } catch (e) {
          console.warn(`[bus:item] could not give ${id}: ${e}`);
          tell(player, t("bus.command.item.give_failed"));
        }
      });
      return reply(origin, CustomCommandStatus.Success, "bus.command.item.give_done", "Item given.");
    }

    // ---- name / lore: edit the held item ----
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
