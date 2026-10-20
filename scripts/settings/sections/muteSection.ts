import { system, type Player } from "@minecraft/server";
import { CustomForm, ObservableUIRawMessage } from "@minecraft/server-ui";
import { formatDuration } from "../../core/duration";
import { raw, t } from "../../core/lang";
import { MUTE_KEY } from "../../moderation/mute";
import { getMute, getMutes, unmutePlayer } from "../../moderation/muteStore";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

// Same key as /bus:mute, so one permission controls the command and this menu.
registerSettingsSection({
    id: MUTE_KEY,
    title: t("bus.section.mute.title"),
    description: t("bus.section.mute.desc"),
    order: 70,
    open: (player, back) => muteList(player, back),
});

function muteList(player: Player, back: () => void): void {
    const guard = createGuard(player, MUTE_KEY);
    if (!guard.check()) return;
    showForm(player, () => {
        const form = guard.attach(new CustomForm(player, t("bus.section.mute.title")));
        const entries = Object.entries(getMutes());
        form.label(t(entries.length ? "bus.mute.list.pick" : "bus.mute.list.none"));
        for (const [id, record] of entries) {
            form.button(
                raw(record.name),
                guard.click(() => {
                    form.close();
                    muteDetail(player, id, () => muteList(player, back));
                })
            );
        }
        form.divider().button(t("bus.common.back"), () => {
            form.close();
            back();
        });
        return form.closeButton();
    });
}

function muteDetail(player: Player, id: string, back: () => void): void {
    const record = getMutes()[id];
    if (!record) return back();
    const guard = createGuard(player, MUTE_KEY);
    if (!guard.check()) return;

    // Live countdown: one update per second, and only while this screen is open.
    let timer: number | undefined;
    const stopTimer = (): void => {
        if (timer !== undefined) system.clearRun(timer);
        timer = undefined;
    };

    showForm(
        player,
        () => {
            const form = guard.attach(new CustomForm(player, raw(record.name)));
            form.label(t("bus.mute.detail.by", record.by || "?"));

            const until = record.until;
            if (until === undefined) {
                form.label(t("bus.mute.detail.permanent"));
            } else {
                const timeLeft = new ObservableUIRawMessage(t("bus.mute.detail.time_left", formatDuration(until - Date.now())));
                form.label(timeLeft);
                stopTimer(); // the form can be rebuilt if the first attempt was busy
                timer = system.runInterval(() => {
                    if (!player.isValid) return stopTimer();
                    const remaining = until - Date.now();
                    // Ended: either the time ran out or somebody unmuted them in the meantime.
                    if (remaining <= 0 || !getMute(id)) {
                        timeLeft.setData(t("bus.mute.detail.ended"));
                        return stopTimer();
                    }
                    timeLeft.setData(t("bus.mute.detail.time_left", formatDuration(remaining)));
                }, 20);
            }

            form.label(record.reason ? t("bus.mute.detail.reason", record.reason) : t("bus.mute.detail.no_reason"));
            form.divider();
            form.button(
                t("bus.mute.detail.unmute"),
                guard.click(() => {
                    unmutePlayer(id);
                    form.close();
                    back();
                })
            );
            form.button(t("bus.common.back"), () => {
                form.close();
                back();
            });
            return form.closeButton();
        },
        stopTimer
    );
}
