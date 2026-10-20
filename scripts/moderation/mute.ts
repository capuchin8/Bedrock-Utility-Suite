import { CustomCommandParamType, CustomCommandStatus, Player, system, world } from "@minecraft/server";
import { onChat } from "../chat/chatPipeline";
import { defineBusCommand } from "../commands/busCommand";
import type { UIRawMessage } from "@minecraft/server-ui";
import { reply } from "../core/commandResult";
import { durationParameter, formatDuration, parseDuration } from "../core/duration";
import { raw, t, tell } from "../core/lang";
import { canUse, isOwner, registerPermission } from "../permissions/permissionStore";
import { chatLineOrVanilla } from "../roles/chatFormat";
import { isChatSupported } from "../roles/chatSupport";
import { MAX_MUTES, MAX_REASON_LENGTH, getMute, getMutes, isMuted, mutePlayer, unmutePlayer, type MuteRecord } from "./muteStore";

/** Permission for /bus:mute, /bus:unmute and the Muted Players menu. */
export const MUTE_KEY = "bus:mute";
/** Permission to see what muted players tried to say. */
export const MUTE_SEE_KEY = "bus:mute_see";
const REASON_SETTING = "bus:mute_reason_required";

registerPermission({
    key: MUTE_SEE_KEY,
    label: t("bus.perm.mute_see.name"),
    description: t("bus.perm.mute_see.desc"),
    category: "feature",
    defaultEveryone: false,
});

/** Pack setting (manifest toggle). Also read when the command is registered (see configure below); changing it needs a world reload. */
function reasonRequired(): boolean {
    try {
        return world.getPackSettings()[REASON_SETTING] === true;
    } catch {
        return false;
    }
}

/** "<head> Reason: x Time left: 29m 10s" (reason and time only when they apply). */
function describeMute(head: string, record: MuteRecord): UIRawMessage {
    const parts: UIRawMessage[] = [t(head)];
    if (record.reason) parts.push(raw(" "), t("bus.mute.reason_line", record.reason));
    if (record.until !== undefined) parts.push(raw(" "), t("bus.mute.time_left", formatDuration(record.until - Date.now())));
    return { rawtext: parts };
}

// Muted players' messages are swallowed; staff who may see them get a copy instead, in the same
// chat format the settings define (role, colours, nickname), marked [Muted].
onChat(10, (event) => {
    const sender = event.sender;
    const record = getMute(sender.id);
    if (!record) return false;
    event.cancel = true;
    const line = chatLineOrVanilla(sender, event.message);
    const copy: UIRawMessage = { rawtext: [t("bus.mute.prefix"), raw(" "), raw(line)] };
    system.run(() => {
        if (sender.isValid) sender.sendMessage(describeMute("bus.mute.blocked", record));
        for (const staff of world.getAllPlayers()) {
            if (staff.id !== sender.id && canUse(staff, MUTE_SEE_KEY)) staff.sendMessage(copy);
        }
    });
    return true;
});

defineBusCommand({
    name: "bus:mute",
    description: "Mute a player. Duration: 30m, 2h, 1d12h, or perm (default perm). Put a multi-word reason in quotes. Staff with the right permission still see what they try to say.",
    mandatoryParameters: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    optionalParameters: [durationParameter(), { name: "reason", type: CustomCommandParamType.String }],
    // When the owner turns on "reason required", the command itself is registered with the reason
    // as a mandatory parameter (so the game rejects it without one). Parameters are positional, so
    // the duration becomes mandatory too: /bus:mute <player> <duration> <reason>  (use "perm" for no end).
    configure: (settings) =>
        settings[REASON_SETTING] === true
            ? {
                  mandatoryParameters: [
                      { name: "player", type: CustomCommandParamType.PlayerSelector },
                      durationParameter(),
                      { name: "reason", type: CustomCommandParamType.String },
                  ],
                  optionalParameters: [],
              }
            : undefined,
    permission: { key: MUTE_KEY, label: t("bus.perm.mute_command.name") },
    run: (origin, targets: Player[], durationText?: string, reason?: string) => {
        const fail = (key: string, fallback: string) => reply(origin, CustomCommandStatus.Failure, key, fallback);
        const source = origin.sourceEntity instanceof Player ? origin.sourceEntity : undefined;

        if (!isChatSupported()) return fail("bus.command.mute.no_chat", "Muting needs chat events (Beta APIs).");
        const cleanReason = (reason ?? "").trim().slice(0, MAX_REASON_LENGTH);
        if (reasonRequired() && !cleanReason) return fail("bus.command.mute.reason_required", "A reason is required.");

        // No duration given = no end. "perm" is also accepted so a reason can follow.
        let until: number | undefined;
        if (durationText !== undefined) {
            const parsed = parseDuration(durationText);
            if (!parsed.ok) return fail("bus.command.mute.bad_duration", "Use a duration like 30m, 2h, 1d12h or perm.");
            until = parsed.ms === undefined ? undefined : Date.now() + parsed.ms;
        }

        const online = (targets ?? []).filter((p) => p.isValid);
        if (online.length === 0) return fail("bus.command.mute.not_online", "No matching player is online.");

        // Owners and yourself can't be muted; only an owner (or the console) can mute other staff.
        const sourceIsOwner = !source || isOwner(source);
        const eligible = online.filter(
            (p) => p.id !== source?.id && !isOwner(p) && (sourceIsOwner || !canUse(p, MUTE_KEY))
        );
        if (eligible.length === 0) return fail("bus.command.mute.protected", "That player can't be muted.");

        const already = getMutes();
        const added = eligible.filter((p) => !(p.id in already)).length;
        if (Object.keys(already).length + added > MAX_MUTES) return fail("bus.command.mute.full", "The mute list is full.");

        const by = source?.name ?? "Console";
        const entries = eligible.map((p) => ({ player: p, id: p.id, name: p.name }));
        system.run(() => {
            for (const e of entries) {
                const record: MuteRecord = { name: e.name, reason: cleanReason, by, at: Date.now(), until };
                mutePlayer(e.id, record);
                tell(e.player, describeMute("bus.mute.you_muted", record));
            }
        });
        return reply(origin, CustomCommandStatus.Success, "bus.command.mute.done", "Player muted.");
    },
});

defineBusCommand({
    name: "bus:unmute",
    description: "Unmute an online player (offline players can be unmuted from Settings > Muted Players)",
    mandatoryParameters: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    permission: { key: MUTE_KEY, label: t("bus.perm.unmute_command.name") },
    run: (origin, targets: Player[]) => {
        const muted = (targets ?? []).filter((p) => p.isValid && isMuted(p.id));
        if (muted.length === 0) {
            return reply(origin, CustomCommandStatus.Failure, "bus.command.unmute.not_muted", "That player isn't muted.");
        }
        system.run(() => {
            for (const p of muted) {
                unmutePlayer(p.id);
                tell(p, t("bus.mute.you_unmuted"));
            }
        });
        return reply(origin, CustomCommandStatus.Success, "bus.command.unmute.done", "Player unmuted.");
    },
});
