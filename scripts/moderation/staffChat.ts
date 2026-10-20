import { CustomCommandParamType, CustomCommandStatus, Player, system, world, type CustomCommandOrigin } from "@minecraft/server";
import { onChat } from "../chat/chatPipeline";
import { defineBusCommand } from "../commands/busCommand";
import { reply } from "../core/commandResult";
import type { UIRawMessage } from "@minecraft/server-ui";
import { raw, t } from "../core/lang";
import { canUse } from "../permissions/permissionStore";
import { chatLineOrVanilla } from "../roles/chatFormat";
import { isChatSupported } from "../roles/chatSupport";

const KEY = "bus:staffchat";

// Who currently has staff chat switched on. In memory only: it resets when the player leaves or the
// world reloads, so nobody stays stuck in staff chat by accident.
const active = new Set<string>();

onChat(20, (event) => {
    const sender = event.sender;
    if (!active.has(sender.id)) return false;
    if (!canUse(sender, KEY)) {
        // Lost access while it was on: back to normal chat.
        active.delete(sender.id);
        return false;
    }
    event.cancel = true;
    // Same chat format as normal chat (role, colours, nickname), marked [Staff].
    const line = chatLineOrVanilla(sender, event.message);
    const copy: UIRawMessage = { rawtext: [t("bus.staffchat.prefix"), raw(" "), raw(line)] };
    system.run(() => {
        for (const player of world.getAllPlayers()) {
            if (canUse(player, KEY)) player.sendMessage(copy);
        }
    });
    return true;
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => active.delete(playerId));

function toggle(origin: CustomCommandOrigin, state?: string) {
    const player = origin.sourceEntity;
    if (!(player instanceof Player)) {
        return { status: CustomCommandStatus.Failure, message: "This command must be run by a player." };
    }
    if (!isChatSupported()) {
        return reply(origin, CustomCommandStatus.Failure, "bus.command.staffchat.no_chat", "Staff chat needs chat events (Beta APIs).");
    }
    const next = state === "on" ? true : state === "off" ? false : !active.has(player.id);
    if (next) active.add(player.id);
    else active.delete(player.id);
    return reply(
        origin,
        CustomCommandStatus.Success,
        next ? "bus.command.staffchat.on" : "bus.command.staffchat.off",
        next ? "Staff chat on: your messages go to staff only." : "Staff chat off: your messages go to everyone."
    );
}

// The API has no command aliases, so /bus:sc is its own command sharing the same permission.
// Each command needs its own enum name.
function define(name: string, enumName: string, label: string): void {
    defineBusCommand({
        name,
        description: "Toggle staff chat (on: your messages go to staff only). Optional: on / off.",
        enums: { [enumName]: ["on", "off"] },
        optionalParameters: [{ name: enumName, type: CustomCommandParamType.Enum }],
        permission: { key: KEY, label: t(label) },
        run: (origin, state?: string) => toggle(origin, state),
    });
}

define("bus:staffchat", "bus:staffchat_state", "bus.perm.staffchat_command.name");
define("bus:sc", "bus:sc_state", "bus.perm.sc_command.name");
