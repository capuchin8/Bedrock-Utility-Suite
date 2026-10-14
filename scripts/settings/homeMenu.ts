import type { Player } from "@minecraft/server";
import { CustomForm } from "@minecraft/server-ui";
import { t } from "../core/lang";
import { canUse } from "../permissions/permissionStore";
import { showForm } from "./openForm";
import { getSections } from "./registry";

export function openSettingsHome(player: Player): void {
    const sections = getSections().filter((s) => canUse(player, s.id));
    if (sections.length === 0) {
        player.sendMessage(t("bus.settings.no_access"));
        return;
    }

    showForm(player, () => {
        const form = new CustomForm(player, t("bus.settings.title"));
        form.label(t("bus.settings.choose"));
        form.spacer();

        for (const section of sections) {
            form.button(
                section.title,
                () => {
                    // Re-check at click time in case permissions changed while the form was open.
                    if (!canUse(player, section.id)) {
                        form.close();
                        player.sendMessage(t("bus.settings.access_revoked"));
                        return;
                    }
                    form.close();
                    section.open(player, () => openSettingsHome(player));
                },
                section.description ? { tooltip: section.description } : undefined
            );
        }

        return form.closeButton();
    });
}
