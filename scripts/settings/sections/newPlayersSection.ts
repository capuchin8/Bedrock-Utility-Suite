import type { Player } from "@minecraft/server";
import { CustomForm, ObservableNumber } from "@minecraft/server-ui";
import { raw, t } from "../../core/lang";
import { getNewPlayerSettings, setNewPlayerSettings } from "../../events/newPlayers";
import { getRoles } from "../../roles/roleStore";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

const KEY = "bus:new_players";
const WRITABLE = { clientWritable: true } as const;

registerSettingsSection({
    id: KEY,
    title: t("bus.section.new_players.title"),
    description: t("bus.section.new_players.desc"),
    order: 40,
    open: (player, back) => openNewPlayers(player, back),
});

function openNewPlayers(player: Player, back: () => void): void {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;

    showForm(player, () => {
        const s = getNewPlayerSettings();
        const roleEntries = Object.entries(getRoles());
        // Index 0 = no role; roles follow.
        const roleItems = [
            { label: t("bus.newplayers.role.none"), value: 0 },
            ...roleEntries.map(([, r], i) => ({ label: raw(r.name), value: i + 1 })),
        ];
        const roleIndex = new ObservableNumber(Math.max(0, roleEntries.findIndex(([id]) => id === s.firstJoinRole) + 1), WRITABLE);
        guard.on(roleIndex, (i: number) => setNewPlayerSettings({ firstJoinRole: i > 0 ? roleEntries[i - 1]?.[0] ?? "" : "" }));

        const form = guard.attach(new CustomForm(player, t("bus.section.new_players.title")));
        if (roleEntries.length === 0) form.label(t("bus.newplayers.no_roles"));
        else form.dropdown(t("bus.newplayers.first_role"), roleIndex, roleItems, { description: t("bus.newplayers.first_role.desc") });
        form.divider().button(t("bus.common.back"), () => {
            form.close();
            back();
        });
        return form.closeButton();
    });
}
