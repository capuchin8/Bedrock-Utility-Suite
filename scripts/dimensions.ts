import { system } from "@minecraft/server";

const LOBBY_ID = "bus:lobby";
const MINIGAMES_ID = "bus:minigames";
const STAFF_ID = "bus:staff";

system.beforeEvents.startup.subscribe((event) => {
  event.dimensionRegistry.registerCustomDimension(LOBBY_ID);
  event.dimensionRegistry.registerCustomDimension(MINIGAMES_ID);
  event.dimensionRegistry.registerCustomDimension(STAFF_ID);
});
