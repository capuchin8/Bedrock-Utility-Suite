/**
 * /inventory command — hide / restore / see / see_echest
 *
 * hide/restore now use a "storage entity" approach instead of JSON
 * serialization. Instead of reading each item's properties and rebuilding a
 * fresh ItemStack, the actual ItemStack objects are moved directly into
 * another entity's inventory container. This preserves everything the game
 * engine tracks on the item — including armor trims, which are NOT
 * accessible through any ItemStack component/property in the current
 * scripting API and so cannot be captured by manual serialization.
 *
 * REQUIRES: a custom entity definition in your behavior pack. See the
 * companion file entities/inventory_storage.json — drop it into your BP's
 * entities/ folder. It's a no-model, no-AI, no-gravity, no-collision entity
 * that exists purely to hold items; it's given the invisibility effect on
 * spawn from script rather than needing a resource pack visual definition.
 *
 * Placement: the storage entity spawns at the target player's current X/Z
 * (guarantees the chunk is already loaded so spawnEntity succeeds
 * immediately) at a Y near the top of the dimension's height limit (a few
 * blocks below the build ceiling — not below bedrock, which is outside the
 * dimension's valid coordinate range and isn't spawnable). It's removed
 * immediately after a successful restore since it's no longer needed.
 *
 * see / see_echest are unchanged from before — they just read live data and
 * print it to chat, no storage entity involved.
 */

import {
  system,
  world,
  Player,
  Entity,
  EquipmentSlot,
  CommandPermissionLevel,
  CustomCommandStatus,
  CustomCommandParamType,
  CustomCommandOrigin,
} from "@minecraft/server";

const STORAGE_ENTITY_ID = "bus:inventory_storage";
const STORAGE_ENTITY_KEY_ID = "bus:storage_entity_id"; // dynamic prop on player: string entity id
const HIDDEN_FLAG_KEY = "bus:is_hidden"; // dynamic prop on player: boolean
const SELECTED_SLOT_KEY = "bus:selected_slot"; // dynamic prop on player: number

const ARMOR_SLOTS: EquipmentSlot[] = [
  EquipmentSlot.Head,
  EquipmentSlot.Chest,
  EquipmentSlot.Legs,
  EquipmentSlot.Feet,
  EquipmentSlot.Offhand,
];

// Storage entity container layout: slots 0-35 mirror the player's main
// inventory 1:1, slots 36-40 hold armor + offhand.
const ARMOR_STORAGE_SLOT: Record<string, number> = {
  [EquipmentSlot.Head]: 36,
  [EquipmentSlot.Chest]: 37,
  [EquipmentSlot.Legs]: 38,
  [EquipmentSlot.Feet]: 39,
  [EquipmentSlot.Offhand]: 40,
};

// ---------------------------------------------------------------------------
// Hide / Restore (storage entity approach)
// ---------------------------------------------------------------------------

function hideInventory(player: Player): void {
  if (player.getDynamicProperty(HIDDEN_FLAG_KEY) === true) {
    player.sendMessage("§cYour inventory is already hidden. Use restore first.");
    return;
  }

  const playerInvComponent = player.getComponent("minecraft:inventory");
  const equippable = player.getComponent("minecraft:equippable");
  if (!playerInvComponent?.container || !equippable) return;
  const playerContainer = playerInvComponent.container;

  const dimension = player.dimension;
  const heightRange = dimension.heightRange;
  const spawnLoc = {
    x: player.location.x,
    y: heightRange.max - 5,
    z: player.location.z,
  };

  const storage = dimension.spawnEntity(STORAGE_ENTITY_ID, spawnLoc);
  // Applied from script rather than baked into a resource pack visual.
  storage.addEffect("invisibility", 20000000, { showParticles: false, amplifier: 0 });

  const storageInvComponent = storage.getComponent("minecraft:inventory");
  if (!storageInvComponent?.container) {
    storage.remove();
    player.sendMessage("§cFailed to set up inventory storage. Nothing was hidden.");
    return;
  }
  const storageContainer = storageInvComponent.container;

  // Move main inventory items into the storage entity (0-35).
  for (let i = 0; i < playerContainer.size; i++) {
    const item = playerContainer.getItem(i);
    if (item) storageContainer.setItem(i, item);
  }

  // Move armor + offhand into the storage entity (36-40).
  for (const slot of ARMOR_SLOTS) {
    const item = equippable.getEquipment(slot);
    if (item) storageContainer.setItem(ARMOR_STORAGE_SLOT[slot], item);
    equippable.setEquipment(slot, undefined);
  }

  // Now that everything's copied over, clear the player's own inventory.
  playerContainer.clearAll();

  player.setDynamicProperty(STORAGE_ENTITY_KEY_ID, storage.id);
  player.setDynamicProperty(SELECTED_SLOT_KEY, player.selectedSlotIndex);
  player.setDynamicProperty(HIDDEN_FLAG_KEY, true);

  player.sendMessage("§aYour inventory has been hidden.");
}

function restoreInventory(player: Player): void {
  if (player.getDynamicProperty(HIDDEN_FLAG_KEY) !== true) {
    player.sendMessage("§cYou don't have a hidden inventory to restore.");
    return;
  }

  const storageId = player.getDynamicProperty(STORAGE_ENTITY_KEY_ID) as string | undefined;
  if (!storageId) {
    player.sendMessage("§cNo storage entity reference was found.");
    return;
  }

  const storage = world.getEntity(storageId);
  if (!storage || !storage.isValid) {
    player.sendMessage(
      "§cCouldn't find your stored inventory. It may be in an unloaded area — try again after moving around a bit."
    );
    return;
  }

  const storageInvComponent = storage.getComponent("minecraft:inventory");
  const playerInvComponent = player.getComponent("minecraft:inventory");
  const equippable = player.getComponent("minecraft:equippable");
  if (!storageInvComponent?.container || !playerInvComponent?.container || !equippable) return;

  const storageContainer = storageInvComponent.container;
  const playerContainer = playerInvComponent.container;

  playerContainer.clearAll();
  for (let i = 0; i < playerContainer.size; i++) {
    const item = storageContainer.getItem(i);
    if (item) playerContainer.setItem(i, item);
  }

  for (const slot of ARMOR_SLOTS) {
    const item = storageContainer.getItem(ARMOR_STORAGE_SLOT[slot]);
    equippable.setEquipment(slot, item);
  }

  const selectedSlot = player.getDynamicProperty(SELECTED_SLOT_KEY) as number | undefined;
  if (selectedSlot !== undefined) player.selectedSlotIndex = selectedSlot;

  // Done with the storage entity — remove it immediately, no need to keep it around.
  storage.remove();

  player.setDynamicProperty(STORAGE_ENTITY_KEY_ID, undefined);
  player.setDynamicProperty(SELECTED_SLOT_KEY, undefined);
  player.setDynamicProperty(HIDDEN_FLAG_KEY, false);

  player.sendMessage("§aYour inventory has been restored.");
}

// ---------------------------------------------------------------------------
// See / See Echest (unchanged — live reads, chat output only)
// ---------------------------------------------------------------------------

function formatItemLine(slotLabel: string, item: import("@minecraft/server").ItemStack | undefined): string {
  if (!item) return `§7${slotLabel}: §8(empty)`;

  let line = `§7${slotLabel}: §f${item.typeId.replace("minecraft:", "")} §7x${item.amount}`;

  const durability = item.getComponent("minecraft:durability");
  if (durability) {
    const maxDurability = durability.maxDurability;
    const remaining = maxDurability - durability.damage;
    line += ` §7(dur ${remaining}/${maxDurability})`;
  }

  const enchantable = item.getComponent("minecraft:enchantable");
  if (enchantable) {
    const list = enchantable.getEnchantments();
    if (list.length > 0) {
      const enchStr = list.map((e) => `${e.type.id.replace("minecraft:", "")} ${e.level}`).join(", ");
      line += ` §7[${enchStr}]`;
    }
  }

  if (item.nameTag) line += ` §7"${item.nameTag}"`;

  return line;
}

function seeInventory(runner: Player, target: Player): void {
  const invComponent = target.getComponent("minecraft:inventory");
  const equippable = target.getComponent("minecraft:equippable");

  runner.sendMessage(`§e--- ${target.name}'s inventory ---`);

  if (invComponent?.container) {
    const container = invComponent.container;
    for (let i = 0; i < container.size; i++) {
      const item = container.getItem(i);
      if (item) runner.sendMessage(formatItemLine(`Slot ${i}`, item));
    }
  }

  if (equippable) {
    for (const slot of ARMOR_SLOTS) {
      const item = equippable.getEquipment(slot);
      if (item) runner.sendMessage(formatItemLine(slot, item));
    }
  }

  runner.sendMessage("§e--- end ---");
}

function seeEnderChest(runner: Player, target: Player): void {
  // Player entities carry their own ender inventory directly.
  // componentId: "minecraft:ender_inventory".
  const enderInv = target.getComponent("minecraft:ender_inventory" as any) as
    { container?: import("@minecraft/server").Container } | undefined;

  if (!enderInv?.container) {
    runner.sendMessage("§cCouldn't access that player's ender chest.");
    return;
  }

  const container = enderInv.container;
  runner.sendMessage(`§e--- ${target.name}'s ender chest ---`);
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item) runner.sendMessage(formatItemLine(`Slot ${i}`, item));
  }
  runner.sendMessage("§e--- end ---");
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

system.beforeEvents.startup.subscribe((init) => {
  const registry = init.customCommandRegistry;

  registry.registerEnum("bus:action", ["hide", "restore", "see", "see_echest"]);

  registry.registerCommand(
    {
      name: "bus:inventory",
      description: "Hide, restore, or view a player's inventory.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      mandatoryParameters: [
        { type: CustomCommandParamType.Enum, name: "bus:action" },
        { type: CustomCommandParamType.EntitySelector, name: "target" },
      ],
    },
    (origin: CustomCommandOrigin, action: string, targetEntities: Entity[]) => {
      // Custom command callbacks run in a restricted "early execution"
      // context — defer actual game-state changes to the next tick.
      system.run(() => {
        const players = (targetEntities ?? []).filter((e: Entity): e is Player => e instanceof Player);

        if (players.length === 0) {
          if (origin.sourceEntity instanceof Player) {
            origin.sourceEntity.sendMessage("§cNo valid player targets found.");
          }
          return;
        }

        const runner = origin.sourceEntity instanceof Player ? origin.sourceEntity : undefined;

        for (const target of players) {
          switch (action) {
            case "hide":
              hideInventory(target);
              break;
            case "restore":
              restoreInventory(target);
              break;
            case "see":
              if (runner) seeInventory(runner, target);
              break;
            case "see_echest":
              if (runner) seeEnderChest(runner, target);
              break;
          }
        }
      });

      return { status: CustomCommandStatus.Success };
    }
  );
});
