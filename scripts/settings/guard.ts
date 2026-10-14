import type { Player } from "@minecraft/server";
import type { CustomForm } from "@minecraft/server-ui";
import { t } from "../core/lang";
import { canUse } from "../permissions/permissionStore";

export interface SettingsGuard {
    /** Registers the form so it can be closed if the player loses access. Returns the same form. */
    attach(form: CustomForm): CustomForm;
    /** true while the player may still use this menu. If not: closes the form, tells them, returns false. */
    check(): boolean;
    /** Wraps a button handler so it only runs while access holds. */
    click(fn: () => void): () => void;
    /** Subscribes to an observable; changes are only applied while access holds. */
    on<T>(observable: { subscribe(callback: (value: T) => void): unknown }, handler: (value: T) => void): void;
}

/**
 * Re-checks permissions on every interaction. If a player's access was removed while the menu
 * was open (role revoked, permission edited, op removed), nothing is applied, the menu closes
 * and they are told why.
 */
export function createGuard(player: Player, permissionKey: string): SettingsGuard {
    let form: CustomForm | undefined;
    let revoked = false;

    const check = (): boolean => {
        if (revoked) return false;
        if (canUse(player, permissionKey)) return true;
        revoked = true;
        try {
            form?.close();
        } catch {
            // already closed
        }
        try {
            player.sendMessage(t("bus.settings.access_revoked"));
        } catch {
            // player left
        }
        return false;
    };

    return {
        attach(f) {
            form = f;
            return f;
        },
        check,
        click: (fn) => () => {
            if (check()) fn();
        },
        on(observable, handler) {
            observable.subscribe((value) => {
                if (check()) handler(value);
            });
        },
    };
}
