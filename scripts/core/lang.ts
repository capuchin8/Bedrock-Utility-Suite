import { system, type Player } from "@minecraft/server";
import type { UIRawMessage } from "@minecraft/server-ui";

/**
 * Builds a translatable UI message from a lang key (defined in the behavior pack's
 * texts/en_US.lang). Extra arguments fill %s placeholders in order.
 *   t("bus.roles.edit.title", role.name)  ->  { translate: "...", with: ["Moderator"] }
 */
export function t(key: string, ...args: (string | number)[]): UIRawMessage {
    return args.length > 0 ? { translate: key, with: args.map(String) } : { translate: key };
}

/** Literal text that should not be translated (player names, command names, ...). */
export function raw(text: string): UIRawMessage {
    return { text };
}

/**
 * Sends a translated chat message to a player. Deferred with system.run so it is safe to call from
 * command callbacks and before-events. (Not visible while a DDUI form is open: put in-form feedback
 * in the form itself.)
 */
export function tell(player: Player, message: UIRawMessage): void {
    system.run(() => {
        try {
            if (player.isValid) player.sendMessage(message);
        } catch {
            // player left
        }
    });
}
