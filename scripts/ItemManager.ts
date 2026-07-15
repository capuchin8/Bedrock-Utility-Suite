import { world, system, Player } from "@minecraft/server";
system.beforeEvents.startup.subscribe((eventData) => {
  eventData.itemComponentRegistry.registerCustomComponent("bus_leave:trigger", {
    onUse: (e) => {
      leave(e.source);
    },
  });
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id === "bus_leave:trigger") {
    const source = event.sourceEntity;

    if (source instanceof Player) {
      leave(source);
    }
  }
});

function leave(player: Player) {
  player.runCommand("tag @s remove parkour");
  player.runCommand("tp @s 0 288 0");
  player.runCommand("scoreboard players set @s parkour 0");
  player.runCommand("scoreboard players add @s parkour_leaves 1");
  player.runCommand("playsound parkour_leave @s");
  player.runCommand("clear @s bus:leave");
}
