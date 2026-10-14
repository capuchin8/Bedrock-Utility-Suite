import { CustomCommandStatus, type CustomCommandOrigin, type CustomCommandResult } from "@minecraft/server";

/**
 * One reply, shown as the command's own response (no separate chat message).
 * Players get the lang key (the client translates it); the console and command blocks can't see the
 * resource pack's lang file, so they get the plain-English fallback instead.
 * Note: the result message can't take %s arguments, so keys used here must be argument-free.
 */
export function reply(
    origin: CustomCommandOrigin,
    status: CustomCommandStatus,
    key: string,
    fallback: string
): CustomCommandResult {
    return { status, message: origin.sourceEntity ? key : fallback };
}
