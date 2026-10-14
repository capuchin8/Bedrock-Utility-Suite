import { CustomCommandParamType, CustomCommandStatus, Player, system } from "@minecraft/server";
import { defineBusCommand } from "../commands/busCommand";
import { reply } from "../core/commandResult";
import { t } from "../core/lang";
import { isOperator } from "../permissions/permissionStore";
import { checkNickname, setNickname } from "./nicknameStore";

defineBusCommand({
    name: "bus:nickname",
    description: "Set your nickname, or use 'reset' to clear it",
    optionalParameters: [{ name: "nickname", type: CustomCommandParamType.String }],
    // Same key as the Nickname settings menu, so one permission controls both.
    permission: { key: "bus:nicknames", label: t("bus.perm.nickname_command.name"), defaultEveryone: true },
    run: (origin, nickname?: string) => {
        const player = origin.sourceEntity;
        if (!(player instanceof Player)) {
            // Console has no language to translate to.
            return { status: CustomCommandStatus.Failure, message: "This command must be run by a player." };
        }
        const fail = (key: string, fallback: string) => reply(origin, CustomCommandStatus.Failure, key, fallback);
        if (nickname === undefined) return fail("bus.command.nickname.usage", "Usage: /bus:nickname <name|reset>");

        if (nickname.toLowerCase() === "reset") {
            system.run(() => setNickname(player, undefined));
            return reply(origin, CustomCommandStatus.Success, "bus.command.nickname.cleared", "Nickname reset.");
        }
        const check = checkNickname(player, nickname, isOperator(player));
        if (!check.ok) return fail(check.commandKey, check.fallback);
        const value = check.value;
        system.run(() => setNickname(player, value));
        return reply(origin, CustomCommandStatus.Success, "bus.command.nickname.saved", "Nickname updated.");
    },
});
