import { system, type Player } from "@minecraft/server";
import {
    CustomForm,
    DataDrivenScreenClosedReason,
    FormCancelationReason,
    type ModalFormData,
    type ModalFormResponse,
} from "@minecraft/server-ui";

const RETRY_TICKS = 5;
const MAX_ATTEMPTS = 40; // about 10 seconds

/**
 * Shows a DDUI form, retrying while the player is busy with another screen.
 * A command is typed in chat, so chat is still open when the callback runs and
 * show() resolves with UserBusy. `build` runs on every attempt for a fresh form.
 * Must not be called from restricted-execution mode (wrap in system.run).
 */
export function showForm(player: Player, build: () => CustomForm): void {
    let attempts = 0;
    const attempt = (): void => {
        if (!player.isValid) return;
        try {
            build()
                .show()
                .then((reason) => {
                    if (reason === DataDrivenScreenClosedReason.UserBusy && ++attempts < MAX_ATTEMPTS) {
                        system.runTimeout(attempt, RETRY_TICKS);
                    }
                })
                .catch((e) => console.warn(`[bus:settings] form error: ${e}`));
        } catch (e) {
            console.warn(`[bus:settings] failed to show form: ${e}`);
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
