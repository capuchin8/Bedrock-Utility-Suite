import { CommandPermissionLevel, world, type Player } from "@minecraft/server";
import { hasListedOwners } from "./owners";
import { isOperator } from "./permissionStore";

/**
 * Ownership can be claimed by an operator, but only while there is nobody to ask: no owner has been
 * added yet and no one with Host level (the world's host) is online.
 */
export function canClaimOwnership(player: Player): boolean {
    if (!isOperator(player) || hasListedOwners()) return false;
    return !world.getAllPlayers().some((p) => p.commandPermissionLevel >= CommandPermissionLevel.Host);
}
