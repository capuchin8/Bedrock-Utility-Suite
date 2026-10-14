import { CustomCommandStatus, Player, system } from "@minecraft/server";
import { defineBusCommand } from "../commands/busCommand";
import { t } from "../core/lang";
import { openSettingsHome } from "./homeMenu";

defineBusCommand({
    name: "bus:settings",
    description: "Open the settings menu",
    // Everyone can run it; the home screen only lists menus they have access to.
    permission: { label: t("bus.settings.command_perm"), defaultEveryone: true },
    run: (origin) => {
        const player = origin.sourceEntity;
        if (!(player instanceof Player)) {
            return { status: CustomCommandStatus.Failure, message: "This command must be run by a player." };
        }
        // show() can't run in restricted-execution mode, so defer it.
        system.run(() => openSettingsHome(player));
        return { status: CustomCommandStatus.Success };
    },
});
