import type { Player } from "@minecraft/server";
import type { UIRawMessage } from "@minecraft/server-ui";

/**
 * One entry on the /bus:settings home screen.
 * Registering a section also registers a permission with the same id, so admins can
 * control who sees it from Settings > Permissions.
 */
export interface SettingsSection {
    /** Namespaced id, e.g. "bus:shop". Also the permission key. */
    id: string;
    /** Translated with t("..."): button text and name in the Permissions screen. */
    title: UIRawMessage;
    /** Translated with t("..."): tooltip on the home button. */
    description?: UIRawMessage;
    /** Lower numbers appear first. Defaults to 100. */
    order?: number;
    /** true = everyone can open it until an admin changes that. Default false. */
    defaultEveryone?: boolean;
    /** false = operators can't open it until an admin allows it. Default true. The owner always can. */
    defaultOperators?: boolean;
    /** true = only the owner can open it (hidden from the Permissions screen). */
    ownerOnly?: boolean;
    /**
     * Build and show this section's own form (use showForm from ./openForm and createGuard from ./guard).
     * Call back() from a "Back" button to return to the settings home.
     */
    open(player: Player, back: () => void): void;
}
