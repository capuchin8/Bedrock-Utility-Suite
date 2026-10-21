import type { Player } from "@minecraft/server";
import { CustomForm, ObservableBoolean, ObservableString } from "@minecraft/server-ui";
import { t } from "../../core/lang";
import { StatusLabel } from "../../shop/statusLabel";
import { OBJECTIVE_PATTERN, flushSave, getShop, saveShop, scheduleSave } from "../../shop/shopStore";
import "../../shop/shopCommand";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";
import { openCategoryEditor } from "./shopCategoryEditor";
import { KEY } from "./shopEntryEditor";
import { openTrimEditor } from "./shopTrimEditor";

const W = { clientWritable: true } as const;

registerSettingsSection({
    id: KEY, // editor permission; players use the separate "bus:shop_use" permission (registered by /bus:shop)
    title: t("bus.section.shop.title"),
    description: t("bus.section.shop.desc"),
    order: 45,
    open: (player, back) => openShopSettings(player, back),
});

function openShopSettings(player: Player, back: () => void): void {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;
    const reopen = (): void => openShopSettings(player, back);
    showForm(player, () => {
        const cfg = getShop();
        const currency = new ObservableString(cfg.currencyName, W);
        guard.on(currency, (v: string) => {
            cfg.currencyName = v.trim().slice(0, 24) || cfg.currencyName;
            scheduleSave();
        });
        const modern = new ObservableBoolean(cfg.modernUI, W);
        guard.on(modern, (v: boolean) => {
            cfg.modernUI = v;
            scheduleSave();
        });
        const askMenu = new ObservableBoolean(cfg.openMenu, W);
        guard.on(askMenu, (v: boolean) => {
            cfg.openMenu = v;
            scheduleSave();
        });
        const objective = new ObservableString(cfg.objectiveName, W);
        const status = new StatusLabel();
        const form = guard.attach(new CustomForm(player, t("bus.section.shop.title")));
        const nav = (fn: () => void) =>
            guard.click(() => {
                flushSave();
                form.close();
                fn();
            });
        form.label(t("bus.shopedit.intro"))
            .textField(t("bus.shopedit.currency"), currency, { description: t("bus.shopedit.currency.desc") })
            .textField(t("bus.shopedit.objective"), objective, { description: t("bus.shopedit.objective.desc") })
            .button(
                t("bus.shopedit.objective_apply"),
                guard.click(() => {
                    const name = objective.getData().trim();
                    if (!OBJECTIVE_PATTERN.test(name)) {
                        status.set(t("bus.shopedit.objective.invalid"));
                        return;
                    }
                    cfg.objectiveName = name;
                    saveShop();
                    status.set(t("bus.shopedit.objective.saved"));
                })
            )
            .toggle(t("bus.shopedit.open_menu"), askMenu, { description: t("bus.shopedit.open_menu.desc") })
            .toggle(t("bus.shopedit.modern_ui"), modern, { description: t("bus.shopedit.modern_ui.desc") })
            .button(t("bus.shopedit.open_buy"), nav(() => openCategoryEditor(player, "buy", "buy", reopen)))
            .button(t("bus.shopedit.open_sell"), nav(() => openCategoryEditor(player, "sell", "sell", reopen)))
            .button(t("bus.shopedit.open_trims"), nav(() => openTrimEditor(player, KEY, reopen)))
            .label(status.message, { visible: status.visible })
            .button(t("bus.common.back"), () => {
                flushSave();
                form.close();
                back();
            });
        return form.closeButton();
    });
}
