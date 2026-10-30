import { CustomCommandParamType, CustomCommandStatus, Player, system } from "@minecraft/server";
import { defineBusCommand } from "../commands/busCommand";
import { reply } from "../core/commandResult";
import { t } from "../core/lang";
import { canUse } from "../permissions/permissionStore";
import { openSettingsHome } from "./homeMenu";
import { getSections } from "./registry";

const SECTION_ENUM = "bus:settings_section";

// /bus:settings               -> the home menu
// /bus:settings <section>     -> opens that menu directly (e.g. /bus:settings roles); Back goes to the home menu.
// The section names are the registered ids without "bus:". The list is built at startup, after every module has registered.
defineBusCommand({
  name: "bus:settings",
  description: "Open the settings menu, or a specific menu by name",
  enums: () => ({ [SECTION_ENUM]: getSections().map((s) => s.id.slice("bus:".length)) }),
  optionalParameters: [{ name: SECTION_ENUM, type: CustomCommandParamType.Enum }],
  // Everyone can run it; the home screen only lists menus they have access to.
  permission: { label: t("bus.settings.command_perm"), defaultEveryone: true },
  run: (origin, sectionName?: string) => {
    const player = origin.sourceEntity;
    if (!(player instanceof Player)) {
      return { status: CustomCommandStatus.Failure, message: "This command must be run by a player." };
    }
    if (sectionName === undefined) {
      // show() can't run in restricted-execution mode, so defer it.
      system.run(() => openSettingsHome(player));
      return { status: CustomCommandStatus.Success };
    }

    const section = getSections().find((s) => s.id === `bus:${sectionName}`);
    if (!section) {
      return reply(
        origin,
        CustomCommandStatus.Failure,
        "bus.command.settings.unknown",
        "That settings menu doesn't exist."
      );
    }
    if (!canUse(player, section.id)) {
      return reply(
        origin,
        CustomCommandStatus.Failure,
        "bus.command.settings.no_access",
        "You don't have access to that menu."
      );
    }
    // The section's own guard re-checks access when it opens.
    system.run(() => section.open(player, () => openSettingsHome(player)));
    return { status: CustomCommandStatus.Success };
  },
});
