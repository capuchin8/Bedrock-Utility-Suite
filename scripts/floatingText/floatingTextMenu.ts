/**
 * Menu / form UI for creating and editing floating text and floating
 * scoreboard entities.
 *
 * Built against Minecraft Bedrock Script API v26.30:
 *   @minecraft/server     2.8.0
 *   @minecraft/server-ui  2.1.0
 */
import { CommandPermissionLevel, CustomCommandStatus, Entity, Player, system, Vector3, world } from "@minecraft/server";
import { ActionFormData, ModalFormData, ModalFormResponse } from "@minecraft/server-ui";
import { getDimensions, ScoreboardInfo, readScoreboardInfo, writeScoreboardInfo } from "./floatingTextEntities";

const FLOATING_TEXT_ENTITY_ID = "bus:floatingtext";
const TEXT_SPAWN_EVENT = "text";
const SCOREBOARD_SPAWN_EVENT = "scoreboard";

const colorNames = [
  "§4Dark Red§r",
  "§mMahogony Red§r",
  "§cRed§r",
  "§6Gold§r",
  "§pDandelion§r",
  "§gHoney§r",
  "§eYellow§r",
  "§2Dark Green§r",
  "§qForest Green§r",
  "§aLime Green§r",
  "§bAqua§r",
  "§3Dark Aqua§r",
  "§sCadet Blue§r",
  "§tTeal§r",
  "§1Dark Blue§r",
  "§9Grape§r",
  "§dLight Purple§r",
  "§uDark Lavender§r",
  "§5Dark Purple§r",
  "§nBrown§r",
  "§fWhite§r",
  "§hOff White§r",
  "§7Gray§r",
  "§8Dark Gray§r",
  "§jCharcoal§r",
  "§0Black§r",
];

const colorCodes = [
  "§4",
  "§m",
  "§c",
  "§6",
  "§p",
  "§g",
  "§e",
  "§2",
  "§q",
  "§a",
  "§b",
  "§3",
  "§s",
  "§t",
  "§9",
  "§1",
  "§d",
  "§u",
  "§5",
  "§n",
  "§f",
  "§h",
  "§7",
  "§8",
  "§j",
  "§0",
];

function parseCoordinates(text: string): Vector3 {
  const [x, y, z] = text.trim().split(" ", 3).map(Number);
  return { x, y, z };
}

function formatCoordinates(pos: Vector3, yOffset = 0): string {
  return [pos.x.toFixed(2), (pos.y + yOffset).toFixed(2), pos.z.toFixed(2)].join(" ");
}

function menuReject(viewer: Player, reason: string, nextMenu: (viewer: Player, error?: string) => void): void {
  viewer.playSound("note.bass");
  nextMenu(viewer, reason);
}

/**
 * Registers "/bus:textmenu" (and its shorthand "/textmenu") at world
 * startup. Only players may run it; anyone else (console, command
 * blocks) gets a failure result instead.
 */
system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand(
    {
      name: "bus:floatingtextmenu",
      description: "Open the Floating Text menu.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: true,
    },
    (origin) => {
      const source = origin.initiator ?? origin.sourceEntity;
      if (!(source instanceof Player)) {
        return {
          status: CustomCommandStatus.Failure,
          message: "This command can only be run by a player.",
        };
      }

      // Command callbacks run in read-only mode; escape it before the
      // menu spawns entities or writes dynamic properties.
      system.run(() => showMenu(source));

      return { status: CustomCommandStatus.Success };
    }
  );
});

export function showMenu(viewer: Player, error?: string): void {
  const ui = new ActionFormData()
    .title("Floating Text Menu")
    .body(error ?? "")
    .button("New Floating Text", "textures/ui/book_addtextpage_default")
    .button("New Floating Scoreboard", "textures/ui/book_addpicture_default")
    .button("Edit Loaded Texts", "textures/ui/icon_book_writable");

  ui.show(viewer).then((response) => {
    if (response.canceled) return;
    switch (response.selection) {
      case 0:
        newText(viewer);
        break;
      case 1:
        newScoreboard(viewer);
        break;
      case 2:
        showTexts(viewer);
        break;
    }
  });
}

function newText(viewer: Player): void {
  const pos = viewer.location;
  const ui = new ModalFormData()
    .title("New Floating Text")
    .textField("Text to Display", "Text")
    .textField("Text Posistion", "Coordiates X Y Z", { defaultValue: formatCoordinates(pos) });

  ui.show(viewer).then((response: ModalFormResponse) => {
    if (response.canceled || !response.formValues) return;
    const text = String(response.formValues[0]);
    const { x, y, z } = parseCoordinates(String(response.formValues[1]));

    const entity = viewer.dimension.spawnEntity(
      FLOATING_TEXT_ENTITY_ID,
      { x, y: y - 0.58, z },
      { spawnEvent: TEXT_SPAWN_EVENT }
    );
    entity.nameTag = text === "" ? "Floating Text" : text.replace(/\\n/g, "\n");
  });
}

function newScoreboard(viewer: Player): void {
  const pos = viewer.location;
  const objectiveIds = world.scoreboard.getObjectives().map((o) => o.id);
  if (objectiveIds.length === 0) {
    menuReject(viewer, "§cTo add scoreboards, please create a scoreboard objective. ]:<", showMenu);
    return;
  }

  const ui = new ModalFormData()
    .title("New Floating Scoreboard")
    .dropdown("Scoreboard Objective to Display", objectiveIds, { defaultValueIndex: 0 })
    .textField("Scoreboard Position", "Coordiates X Y Z", { defaultValue: formatCoordinates(pos) })
    .dropdown("Scores Organization", ["ascending", "descending"], { defaultValueIndex: 1 })
    .toggle("Enumerate Players", { defaultValue: true })
    .toggle("Hide Offline Players", { defaultValue: false })
    .dropdown("Enumeration Color", colorNames, { defaultValueIndex: 3 })
    .dropdown("Player Name Color", colorNames, { defaultValueIndex: 20 })
    .dropdown("Score Color", colorNames, { defaultValueIndex: 2 })
    .slider("Amount of listed Players", 1, 15, { valueStep: 1, defaultValue: 8 });

  ui.show(viewer).then((response: ModalFormResponse) => {
    if (response.canceled || !response.formValues) return;
    const values = response.formValues;
    const { x, y, z } = parseCoordinates(String(values[1]));

    const entity = viewer.dimension.spawnEntity(
      FLOATING_TEXT_ENTITY_ID,
      { x, y: y - 0.58, z },
      { spawnEvent: SCOREBOARD_SPAWN_EVENT }
    );

    const info: ScoreboardInfo = {
      objectiveId: objectiveIds[Number(values[0])],
      sortOrder: values[2] === 0 ? "ascending" : "descending",
      enumeratePlayers: Boolean(values[3]),
      hideOfflinePlayers: Boolean(values[4]),
      enumerationColor: colorCodes[Number(values[5])],
      playerNameColor: colorCodes[Number(values[6])],
      scoreColor: colorCodes[Number(values[7])],
      maxListed: Number(values[8]),
    };
    writeScoreboardInfo(entity, info);
    entity.nameTag = "LOADING...";
  });
}

interface FoundText {
  entity: Entity;
  isScoreboard: boolean;
}

function showTexts(viewer: Player): void {
  const found: FoundText[] = [];
  for (const dimension of getDimensions()) {
    for (const entity of dimension.getEntities({ type: "bus:floatingtext", families: ["inanimate"] })) {
      found.push({ entity, isScoreboard: entity.matches({ families: ["scoreboard"] }) });
    }
  }

  if (found.length === 0) {
    menuReject(viewer, "§cTry again later when you have active floating text! ^-^", showMenu);
    return;
  }

  const ui = new ActionFormData()
    .title("Edit Nearby Texts")
    .body("Note: Only texts that are in loaded chunks will show up.");

  for (const { entity, isScoreboard } of found) {
    const label = entity.nameTag.replace(/\n.+/g, "");
    ui.button(`${label}§r\n§8[${isScoreboard ? "Scoreboard" : "Text"}]`);
  }

  ui.show(viewer).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    const target = found[response.selection];
    if (target.isScoreboard) editScoreboard(viewer, target.entity);
    else editText(viewer, target.entity);
  });
}

function editText(viewer: Player, entity: Entity): void {
  const pos = entity.location;
  const ui = new ModalFormData()
    .title(entity.nameTag.replace(/\n.+/g, ""))
    .textField("Text to Display", "Text", { defaultValue: entity.nameTag.replace(/\n/g, "\\n") })
    .textField("Text Posistion", "Coordiates X Y Z", { defaultValue: formatCoordinates(pos, 0.58) })
    .toggle("§cDelete Floating Text?§r", { defaultValue: false });

  ui.show(viewer).then((response: ModalFormResponse) => {
    if (response.canceled || !response.formValues) return;
    if (response.formValues[2]) {
      entity.remove();
      return;
    }

    const text = String(response.formValues[0]);
    const { x, y, z } = parseCoordinates(String(response.formValues[1]));
    entity.nameTag = text === "" ? "Floating Text" : text.replace(/\\n/g, "\n");
    entity.teleport({ x, y: y - 0.58, z });
  });
}

function editScoreboard(viewer: Player, entity: Entity): void {
  const pos = entity.location;
  const objectiveIds = world.scoreboard.getObjectives().map((o) => o.id);
  const info = readScoreboardInfo(entity);
  if (!info) {
    entity.remove();
    return;
  }

  const ui = new ModalFormData()
    .title(entity.nameTag.replace(/\n.+/g, ""))
    .dropdown("Scoreboard Objective to Display", objectiveIds, {
      defaultValueIndex: Math.max(0, objectiveIds.indexOf(info.objectiveId)),
    })
    .textField("Scoreboard Position", "Coordiates X Y Z", { defaultValue: formatCoordinates(pos, 0.58) })
    .dropdown("Scores Organization", ["ascending", "descending"], {
      defaultValueIndex: info.sortOrder === "ascending" ? 0 : 1,
    })
    .toggle("Enumerate Players", { defaultValue: info.enumeratePlayers })
    .toggle("Hide Offline Players", { defaultValue: info.hideOfflinePlayers })
    .dropdown("Enumeration Color", colorNames, { defaultValueIndex: colorCodes.indexOf(info.enumerationColor) })
    .dropdown("Player Name Color", colorNames, { defaultValueIndex: colorCodes.indexOf(info.playerNameColor) })
    .dropdown("Score Color", colorNames, { defaultValueIndex: colorCodes.indexOf(info.scoreColor) })
    .slider("Ammount of listed Players", 1, 15, { valueStep: 1, defaultValue: info.maxListed })
    .toggle("§cDelete Floating Text?§r", { defaultValue: false });

  ui.show(viewer).then((response: ModalFormResponse) => {
    if (response.canceled || !response.formValues) return;
    const values = response.formValues;
    if (values[9]) {
      entity.remove();
      return;
    }

    const { x, y, z } = parseCoordinates(String(values[1]));
    entity.nameTag = "LOADING...";

    const updated: ScoreboardInfo = {
      objectiveId: objectiveIds[Number(values[0])],
      sortOrder: values[2] === 0 ? "ascending" : "descending",
      enumeratePlayers: Boolean(values[3]),
      hideOfflinePlayers: Boolean(values[4]),
      enumerationColor: colorCodes[Number(values[5])],
      playerNameColor: colorCodes[Number(values[6])],
      scoreColor: colorCodes[Number(values[7])],
      maxListed: Number(values[8]),
    };
    writeScoreboardInfo(entity, updated);
    entity.teleport({ x, y: y - 0.58, z });
  });
}
