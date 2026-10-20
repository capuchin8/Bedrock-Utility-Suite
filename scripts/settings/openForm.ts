import { system, type Player } from "@minecraft/server";
import {
    CustomForm,
    DataDrivenScreenClosedReason,
    FormCancelationReason,
    type ModalFormData,
    type ModalFormResponse,
} from "@minecraft/server-ui";

// Running a command already closes the chat screen, so a form normally opens on the first try.
// The short retry is only a safety net for the odd tick where another screen is still closing
// (for example when one form is closed and the next opened straight away).
const RETRY_TICKS = 4;
const MAX_ATTEMPTS = 5;

/**
 * Shows a DDUI form, retrying briefly if the player is busy with another screen.
 * `build` runs on every attempt for a fresh form.
 * `onClosed` runs once when the form is finally gone (closed by the player, by code, or failed to
 * open), e.g. to stop a timer that updates a label while the form is open.
 * Must not be called from restricted-execution mode (wrap in system.run).
 */
export function showForm(player: Player, build: () => CustomForm, onClosed?: () => void): void {
    let attempts = 0;
    const attempt = (): void => {
        if (!player.isValid) return;
        try {
            build()
                .show()
                .then((reason) => {
                    if (reason === DataDrivenScreenClosedReason.UserBusy && ++attempts < MAX_ATTEMPTS) {
                        system.runTimeout(attempt, RETRY_TICKS);
                        return;
                    }
                    onClosed?.();
                })
                .catch((e) => {
                    console.warn(`[bus:settings] form error: ${e}`);
                    onClosed?.();
                });
        } catch (e) {
            console.warn(`[bus:settings] failed to show form: ${e}`);
            onClosed?.();
        }
    };
    attempt();
}

/** Same idea for classic ModalFormData (used by the full-size code editor). */
export function showModal(
    player: Player,
    build: () => ModalFormData,
    onResult: (response: ModalFormResponse) => void
): void {
    let attempts = 0;
    const attempt = (): void => {
        if (!player.isValid) return;
        build()
            .show(player)
            .then((response) => {
                if (
                    response.canceled &&
                    response.cancelationReason === FormCancelationReason.UserBusy &&
                    ++attempts < MAX_ATTEMPTS
                ) {
                    system.runTimeout(attempt, RETRY_TICKS);
                    return;
                }
                onResult(response);
            })
            .catch((e) => console.warn(`[bus:settings] modal error: ${e}`));
    };
    attempt();
}
