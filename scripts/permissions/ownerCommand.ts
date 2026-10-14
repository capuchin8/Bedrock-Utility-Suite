import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, Player, system } from "@minecraft/server";
import { defineBusCommand } from "../commands/busCommand";
import { reply } from "../core/commandResult";
import { t, tell } from "../core/lang";
import { addListedOwner, removeListedOwner } from "./owners";
import { canClaimOwnership } from "./ownership";
import { isOwner } from "./permissionStore";

// Visible to Admin level and up by default, so regular players never see it (a pack setting
// bus:command_permission_owner can still change that). On a dedicated server the console can add the first owner.
defineBusCommand({
    name: "bus:owner",
    description: "Add or remove a BUS owner (full access to every settings menu)",
    essential: true, // can't be disabled by a pack setting, otherwise a world could never get an owner
    defaultLevel: CommandPermissionLevel.Admin,
    enums: { "bus:owner_action": ["add", "remove"] },
    mandatoryParameters: [
        { name: "bus:owner_action", type: CustomCommandParamType.Enum },
        { name: "player", type: CustomCommandParamType.PlayerSelector },
    ],
    permission: { label: t("bus.perm.owner_command.name"), ownerOnly: true },
    access: canClaimOwnership,
    run: (origin, action: string, targets: Player[]) => {
        const source = origin.sourceEntity instanceof Player ? origin.sourceEntity : undefined;
        const target = targets?.[0];
        if (!target) return reply(origin, CustomCommandStatus.Failure, "bus.command.owner.not_online", "No matching player is online.");

        const adding = action === "add";
        // Not an owner yet: the only thing allowed is claiming ownership for yourself.
        if (source && !isOwner(source)) {
            if (!adding || target.id !== source.id) {
                return reply(origin, CustomCommandStatus.Failure, "bus.command.owner.claim_self", "You can only add yourself.");
            }
            if (!canClaimOwnership(source)) {
                return reply(origin, CustomCommandStatus.Failure, "bus.command.no_permission", "No permission.");
            }
        }

        system.run(() => {
            if (adding) addListedOwner(target.id, target.name);
            else removeListedOwner(target.id);
        });
        if (source?.id !== target.id && target.isValid) {
            tell(target, t(adding ? "bus.owner.added" : "bus.owner.removed", target.name));
        }
        return reply(
            origin,
            CustomCommandStatus.Success,
            adding ? "bus.command.owner.added" : "bus.command.owner.removed",
            `${adding ? "Added" : "Removed"} owner ${target.name}`
        );
    },
});
