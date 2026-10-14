import { system, world, type Player } from "@minecraft/server";
import { CustomForm, DataDrivenScreenClosedReason, ObservableBoolean } from "@minecraft/server-ui";
import { onPlayerJoin } from "../events/playerEvents";
import { raw, t } from "../core/lang";
import { expandText } from "../roles/display";
import { getRulesSettings, markRulesAccepted, mustAcceptRules } from "./rulesStore";

const REOPEN_TICKS = 10; // closed with the X: put it straight back
const BUSY_TICKS = 20; // chat or another screen is open: try again shortly
const JOIN_DELAY_TICKS = 40; // let the join/loading screen finish first

// One prompt per player at a time.
const open = new Set<string>();

/**
 * Shows the rules. In normal mode the form comes back whenever it is closed without accepting
 * (the X, Escape...) until the player accepts. In preview mode nothing is saved and it never reopens.
 * readOnly (used by clickable blocks) just displays the rules with a Close button: no accept toggle,
 * nothing saved, never reopens.
 */
export function showRules(player: Player, options: { preview?: boolean; readOnly?: boolean; onDone?: () => void } = {}): void {
    if (options.readOnly) return showRulesReadOnly(player);
    const preview = options.preview === true;
    if (!preview) {
        if (open.has(player.id)) return;
        open.add(player.id);
    }

    const finish = (): void => {
        open.delete(player.id);
        options.onDone?.();
    };

    const attempt = (): void => {
        if (!player.isValid) return void open.delete(player.id);
        // Settings may have changed while we were waiting.
        if (!preview && !mustAcceptRules(player)) return finish();

        const s = getRulesSettings();
        const accepted = new ObservableBoolean(false, { clientWritable: true });
        const continueDisabled = new ObservableBoolean(true);
        accepted.subscribe((v) => continueDisabled.setData(!v));
        let done = false;

        const form = new CustomForm(player, raw(s.title));
        form.label(t(preview ? "bus.rules.preview_note" : "bus.rules.intro"));
        s.rules
            .filter((r) => r.trim())
            .forEach((rule, i) => {
                // &c colour codes and a typed \n become real formatting / line breaks.
                const text = expandText(rule).replace(/\\n/g, "\n");
                form.label(s.numbered ? t("bus.rules.item", i + 1, text) : raw(text));
            });
        form.divider()
            .toggle(t("bus.rules.accept"), accepted)
            .button(
                t("bus.rules.continue"),
                () => {
                    // Checked here too: the client toggle alone isn't trusted.
                    if (!accepted.getData()) return;
                    done = true;
                    if (!preview) markRulesAccepted(player);
                    form.close();
                    finish();
                },
                { disabled: continueDisabled }
            );

        form.show()
            .then((reason) => {
                if (done) return;
                if (preview) return finish();
                // Not accepted: reopen (after a longer wait if the player is busy with another screen).
                system.runTimeout(attempt, reason === DataDrivenScreenClosedReason.UserBusy ? BUSY_TICKS : REOPEN_TICKS);
            })
            .catch((e) => {
                console.warn(`[bus:rules] form error: ${e}`);
                if (!done && !preview) system.runTimeout(attempt, BUSY_TICKS);
            });
    };
    attempt();
}

function showRulesReadOnly(player: Player): void {
    if (!player.isValid) return;
    const s = getRulesSettings();
    const form = new CustomForm(player, raw(s.title));
    s.rules
        .filter((r) => r.trim())
        .forEach((rule, i) => {
            const text = expandText(rule).replace(/\\n/g, "\n");
            form.label(s.numbered ? t("bus.rules.item", i + 1, text) : raw(text));
        });
    form.divider().button(t("bus.common.close"), () => form.close());
    form.show().catch((e) => console.warn(`[bus:rules] read-only form error: ${e}`));
}

/** Prompts every online player who still has to accept (used after the owner asks for a re-accept). */
export function promptAllPending(): void {
    for (const player of world.getAllPlayers()) if (mustAcceptRules(player)) showRules(player);
}

onPlayerJoin((player) => {
    system.runTimeout(() => {
        if (player.isValid && mustAcceptRules(player)) showRules(player);
    }, JOIN_DELAY_TICKS);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => open.delete(playerId));
