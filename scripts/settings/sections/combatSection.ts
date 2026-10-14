import type { Player } from "@minecraft/server";
import { CustomForm, ObservableBoolean, ObservableNumber } from "@minecraft/server-ui";
import { getCombatSettings, setCombatSettings } from "../../combat/combatStore";
import { t } from "../../core/lang";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

const KEY = "bus:combat";
const WRITABLE = { clientWritable: true } as const;

registerSettingsSection({
    id: KEY,
    title: t("bus.section.combat.title"),
    description: t("bus.section.combat.desc"),
    order: 60,
    open: (player, back) => openCombat(player, back),
});

function openCombat(player: Player, back: () => void): void {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;
    showForm(player, () => {
        const s = getCombatSettings();
        const enabled = new ObservableBoolean(s.enabled, WRITABLE);
        const seconds = new ObservableNumber(s.seconds, WRITABLE);
        const pvpOnly = new ObservableBoolean(s.pvpOnly, WRITABLE);
        const clearOnDeath = new ObservableBoolean(s.clearOnDeath, WRITABLE);
        const exemptCreative = new ObservableBoolean(s.exemptCreative, WRITABLE);

        guard.on(enabled, (v: boolean) => setCombatSettings({ enabled: v }));
        guard.on(seconds, (v: number) => setCombatSettings({ seconds: v }));
        guard.on(pvpOnly, (v: boolean) => setCombatSettings({ pvpOnly: v }));
        guard.on(clearOnDeath, (v: boolean) => setCombatSettings({ clearOnDeath: v }));
        guard.on(exemptCreative, (v: boolean) => setCombatSettings({ exemptCreative: v }));

        const form = guard.attach(new CustomForm(player, t("bus.section.combat.title")));
        form.label(t("bus.combat.intro"))
            .toggle(t("bus.combat.enabled"), enabled, { description: t("bus.combat.enabled.desc") })
            .slider(t("bus.combat.seconds"), seconds, 1, 120, { step: 1, description: t("bus.combat.seconds.desc"), visible: enabled })
            .toggle(t("bus.combat.pvp_only"), pvpOnly, { description: t("bus.combat.pvp_only.desc"), visible: enabled })
            .toggle(t("bus.combat.clear_on_death"), clearOnDeath, { visible: enabled })
            .toggle(t("bus.combat.exempt_creative"), exemptCreative, { description: t("bus.combat.exempt_creative.desc"), visible: enabled })
            .divider()
            .button(t("bus.common.back"), () => {
                form.close();
                back();
            });
        return form.closeButton();
    });
}
