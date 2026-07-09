// scripts/main.ts
import { world as world2, system as system2 } from "@minecraft/server";

// scripts/inventoryCommand.ts
import {
  system,
  world,
  Player,
  EquipmentSlot,
  CommandPermissionLevel,
  CustomCommandStatus,
  CustomCommandParamType
} from "@minecraft/server";
var STORAGE_ENTITY_ID = "bus:inventory_storage";
var STORAGE_ENTITY_KEY_ID = "bus:storage_entity_id";
var HIDDEN_FLAG_KEY = "bus:is_hidden";
var SELECTED_SLOT_KEY = "bus:selected_slot";
var ARMOR_SLOTS = [
  EquipmentSlot.Head,
  EquipmentSlot.Chest,
  EquipmentSlot.Legs,
  EquipmentSlot.Feet,
  EquipmentSlot.Offhand
];
var ARMOR_STORAGE_SLOT = {
  [EquipmentSlot.Head]: 36,
  [EquipmentSlot.Chest]: 37,
  [EquipmentSlot.Legs]: 38,
  [EquipmentSlot.Feet]: 39,
  [EquipmentSlot.Offhand]: 40
};
function hideInventory(player) {
  if (player.getDynamicProperty(HIDDEN_FLAG_KEY) === true) {
    player.sendMessage("\xA7cYour inventory is already hidden. Use restore first.");
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
    z: player.location.z
  };
  const storage = dimension.spawnEntity(STORAGE_ENTITY_ID, spawnLoc);
  storage.addEffect("invisibility", 2e7, { showParticles: false, amplifier: 0 });
  const storageInvComponent = storage.getComponent("minecraft:inventory");
  if (!storageInvComponent?.container) {
    storage.remove();
    player.sendMessage("\xA7cFailed to set up inventory storage. Nothing was hidden.");
    return;
  }
  const storageContainer = storageInvComponent.container;
  for (let i = 0; i < playerContainer.size; i++) {
    const item = playerContainer.getItem(i);
    if (item) storageContainer.setItem(i, item);
  }
  for (const slot of ARMOR_SLOTS) {
    const item = equippable.getEquipment(slot);
    if (item) storageContainer.setItem(ARMOR_STORAGE_SLOT[slot], item);
    equippable.setEquipment(slot, void 0);
  }
  playerContainer.clearAll();
  player.setDynamicProperty(STORAGE_ENTITY_KEY_ID, storage.id);
  player.setDynamicProperty(SELECTED_SLOT_KEY, player.selectedSlotIndex);
  player.setDynamicProperty(HIDDEN_FLAG_KEY, true);
  player.sendMessage("\xA7aYour inventory has been hidden.");
}
function restoreInventory(player) {
  if (player.getDynamicProperty(HIDDEN_FLAG_KEY) !== true) {
    player.sendMessage("\xA7cYou don't have a hidden inventory to restore.");
    return;
  }
  const storageId = player.getDynamicProperty(STORAGE_ENTITY_KEY_ID);
  if (!storageId) {
    player.sendMessage("\xA7cNo storage entity reference was found.");
    return;
  }
  const storage = world.getEntity(storageId);
  if (!storage || !storage.isValid) {
    player.sendMessage(
      "\xA7cCouldn't find your stored inventory. It may be in an unloaded area \u2014 try again after moving around a bit."
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
  const selectedSlot = player.getDynamicProperty(SELECTED_SLOT_KEY);
  if (selectedSlot !== void 0) player.selectedSlotIndex = selectedSlot;
  storage.remove();
  player.setDynamicProperty(STORAGE_ENTITY_KEY_ID, void 0);
  player.setDynamicProperty(SELECTED_SLOT_KEY, void 0);
  player.setDynamicProperty(HIDDEN_FLAG_KEY, false);
  player.sendMessage("\xA7aYour inventory has been restored.");
}
function formatItemLine(slotLabel, item) {
  if (!item) return `\xA77${slotLabel}: \xA78(empty)`;
  let line = `\xA77${slotLabel}: \xA7f${item.typeId.replace("minecraft:", "")} \xA77x${item.amount}`;
  const durability = item.getComponent("minecraft:durability");
  if (durability) {
    const maxDurability = durability.maxDurability;
    const remaining = maxDurability - durability.damage;
    line += ` \xA77(dur ${remaining}/${maxDurability})`;
  }
  const enchantable = item.getComponent("minecraft:enchantable");
  if (enchantable) {
    const list = enchantable.getEnchantments();
    if (list.length > 0) {
      const enchStr = list.map((e) => `${e.type.id.replace("minecraft:", "")} ${e.level}`).join(", ");
      line += ` \xA77[${enchStr}]`;
    }
  }
  if (item.nameTag) line += ` \xA77"${item.nameTag}"`;
  return line;
}
function seeInventory(runner, target) {
  const invComponent = target.getComponent("minecraft:inventory");
  const equippable = target.getComponent("minecraft:equippable");
  runner.sendMessage(`\xA7e--- ${target.name}'s inventory ---`);
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
  runner.sendMessage("\xA7e--- end ---");
}
function seeEnderChest(runner, target) {
  const enderInv = target.getComponent("minecraft:ender_inventory");
  if (!enderInv?.container) {
    runner.sendMessage("\xA7cCouldn't access that player's ender chest.");
    return;
  }
  const container = enderInv.container;
  runner.sendMessage(`\xA7e--- ${target.name}'s ender chest ---`);
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item) runner.sendMessage(formatItemLine(`Slot ${i}`, item));
  }
  runner.sendMessage("\xA7e--- end ---");
}
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
        { type: CustomCommandParamType.EntitySelector, name: "target" }
      ]
    },
    (origin, action, targetEntities) => {
      system.run(() => {
        const players = (targetEntities ?? []).filter((e) => e instanceof Player);
        if (players.length === 0) {
          if (origin.sourceEntity instanceof Player) {
            origin.sourceEntity.sendMessage("\xA7cNo valid player targets found.");
          }
          return;
        }
        const runner = origin.sourceEntity instanceof Player ? origin.sourceEntity : void 0;
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

// scripts/main.ts
function mainTick() {
  if (system2.currentTick % 100 === 0) {
    world2.sendMessage("Hello starter! Tick: " + system2.currentTick);
  }
  system2.run(mainTick);
}
system2.run(mainTick);

//# sourceMappingURL=../debug/main.js.map
