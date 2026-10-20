import { system, type Player } from "@minecraft/server";
import type { UIRawMessage } from "@minecraft/server-ui";

/**
 * Builds a translatable UI message from a lang key (defined in the behavior pack's
 * texts/en_US.lang). Extra arguments fill %s placeholders in order.
 *   t("bus.roles.edit.title", role.name)  ->  { translate: "...", with: ["Moderator"] }
 * Arguments may also be UIRawMessages (e.g. t("bus.mute.time_left", formatDuration(ms))).
 */
export function t(key: string, ...args: (string | number | UIRawMessage)[]): UIRawMessage {
    if (args.length === 0) return { translate: key };
    // An argument can itself be a message (e.g. a formatted duration); then every argument goes in as rawtext.
    if (args.some((a) => typeof a === "object")) {
        return { translate: key, with: { rawtext: args.map((a) => (typeof a === "object" ? a : { text: String(a) })) } };
    }
    return { translate: key, with: args.map(String) };
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
