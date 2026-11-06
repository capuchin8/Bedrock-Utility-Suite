/**
 * /bus:inventory <hide|restore|see|see_echest> <target>
 *
 * hide/restore are a thin wrapper around inventory/inventoryVault.ts, which other modules can call
 * directly. This file only handles the command: targets, permissions, and feedback.
 *
 * Feedback: the command's own response goes to whoever ran it (player, console or command block). The
 * target is never notified. Reading and writing containers can't happen inside the command callback,
 * so the work is deferred with system.run; the response is decided up front from what can be read
 * synchronously (valid targets, hidden flag). If the deferred part fails, the runner is told in chat.
 *
 * see / see_echest print to the runner's chat and do not touch the storage entity.
 */

import {
  CustomCommandParamType,
  CustomCommandStatus,
  EquipmentSlot,
  Player,
  system,
  type Container,
  type Entity,
  type ItemStack,
} from "@minecraft/server";
import type { UIRawMessage } from "@minecraft/server-ui";
import { defineBusCommand } from "./busCommand";
import { reply } from "../core/commandResult";
import { raw, t, tell } from "../core/lang";
import {
  hideInventory,
  isInventoryHidden,
  restoreInventory,
  VAULT_ARMOR_SLOTS,
  type VaultError,
} from "../utils/inventoryVault";

const ACTION_ENUM = "bus:inventory_action";

const EQUIP_LANG_KEY: Record<string, string> = {
  [EquipmentSlot.Head]: "bus.inventory.equip.head",
  [EquipmentSlot.Chest]: "bus.inventory.equip.chest",
  [EquipmentSlot.Legs]: "bus.inventory.equip.legs",
  [EquipmentSlot.Feet]: "bus.inventory.equip.feet",
  [EquipmentSlot.Offhand]: "bus.inventory.equip.offhand",
};

/** A deferred failure: logged, and the runner (never the target) is told in chat. */
function report(runner: Player | undefined, error: VaultError, target: Player): void {
  // already_hidden / not_hidden were filtered out before the work was deferred.
  if (error === "already_hidden" || error === "not_hidden") return;
  console.warn(`[bus:inventory] ${error} for ${target.name}`);
  if (runner) tell(runner, t(`bus.inventory.error.${error}`, target.name));
}

// ---------------------------------------------------------------------------
// See / See Echest (live reads, printed to the runner's chat)
// ---------------------------------------------------------------------------

function itemLine(label: UIRawMessage, item: ItemStack): UIRawMessage {
  const parts: UIRawMessage[] = [label, raw(`§f${item.typeId.replace("minecraft:", "")} §7x${item.amount}`)];

  const durability = item.getComponent("minecraft:durability");
  if (durability) {
    const max = durability.maxDurability;
    parts.push(raw(" "), t("bus.inventory.durability", max - durability.damage, max));
  }

  const list = item.getComponent("minecraft:enchantable")?.getEnchantments() ?? [];
  if (list.length > 0) {
    parts.push(raw(` §7[${list.map((e) => `${e.type.id.replace("minecraft:", "")} ${e.level}`).join(", ")}]`));
  }

  if (item.nameTag) parts.push(raw(` §7"${item.nameTag}"`));
  return { rawtext: parts };
}

function printContainer(runner: Player, container: Container): void {
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item) runner.sendMessage(itemLine(t("bus.inventory.slot", i), item));
  }
}

function seeInventory(runner: Player, target: Player): void {
  runner.sendMessage(t("bus.inventory.see.header", target.name));

  const container = target.getComponent("minecraft:inventory")?.container;
  if (container) printContainer(runner, container);

  const equippable = target.getComponent("minecraft:equippable");
  if (equippable) {
    for (const slot of VAULT_ARMOR_SLOTS) {
      const item = equippable.getEquipment(slot);
      if (item) {
        runner.sendMessage(itemLine({ rawtext: [raw("§7"), t(EQUIP_LANG_KEY[slot]), raw(": ")] }, item));
      }
    }
  }
  runner.sendMessage(t("bus.inventory.see.footer"));
}

function seeEnderChest(runner: Player, target: Player): void {
  // Player entities carry their own ender inventory directly (componentId "minecraft:ender_inventory").
  const enderInv = target.getComponent("minecraft:ender_inventory" as any) as { container?: Container } | undefined;
  if (!enderInv?.container) {
    runner.sendMessage(t("bus.inventory.error.echest", target.name));
    return;
  }
  runner.sendMessage(t("bus.inventory.echest.header", target.name));
  printContainer(runner, enderInv.container);
  runner.sendMessage(t("bus.inventory.see.footer"));
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

defineBusCommand({
  name: "bus:inventory",
  description: "bus.command.inventory.description",
  enums: { [ACTION_ENUM]: ["hide", "restore", "see", "see_echest"] },
  mandatoryParameters: [
    { name: ACTION_ENUM, type: CustomCommandParamType.Enum },
    { name: "target", type: CustomCommandParamType.EntitySelector },
  ],
  permission: { label: t("bus.perm.inventory_command.name") },
  run: (origin, action: string, targets: Entity[]) => {
    const players = (targets ?? []).filter((e: Entity): e is Player => e instanceof Player && e.isValid);
    if (players.length === 0) {
      return reply(
        origin,
        CustomCommandStatus.Failure,
        "bus.command.inventory.no_players",
        "No valid player targets found."
      );
    }
    const runner = origin.sourceEntity instanceof Player ? origin.sourceEntity : undefined;

    // see / see_echest: the content is the output, so it goes to the runner's chat (players only).
    if (action === "see" || action === "see_echest") {
      if (!runner) {
        return reply(origin, CustomCommandStatus.Failure, "bus.command.players_only", "Only players can use this.");
      }
      system.run(() => {
        if (!runner.isValid) return;
        for (const target of players) {
          if (!target.isValid) continue;
          if (action === "see") seeInventory(runner, target);
          else seeEnderChest(runner, target);
        }
      });
      return { status: CustomCommandStatus.Success };
    }

    // hide / restore: decide the response from the hidden flag (readable here), do the work next tick.
    const hiding = action === "hide";
    const eligible = players.filter((p) => isInventoryHidden(p) !== hiding);
    if (eligible.length === 0) {
      return hiding
        ? reply(
            origin,
            CustomCommandStatus.Failure,
            "bus.command.inventory.already_hidden",
            "That inventory is already hidden."
          )
        : reply(
            origin,
            CustomCommandStatus.Failure,
            "bus.command.inventory.not_hidden",
            "That player has no hidden inventory to restore."
          );
    }

    system.run(() => {
      for (const target of eligible) {
        if (!target.isValid) continue;
        const result = hiding ? hideInventory(target) : restoreInventory(target);
        if (!result.ok) report(runner, result.error, target);
      }
    });

    return hiding
      ? reply(origin, CustomCommandStatus.Success, "bus.command.inventory.hidden", "Inventory hidden.")
      : reply(origin, CustomCommandStatus.Success, "bus.command.inventory.restored", "Inventory restored.");
  },
});
