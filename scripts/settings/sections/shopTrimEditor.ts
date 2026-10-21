import { StatusLabel } from "../../shop/statusLabel";
import { system, type Player } from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
import { raw, t } from "../../core/lang";
import { getShop, trimInUse } from "../../shop/shopStore";
import { captureTrimFromHand, deleteTrimTemplate, MAX_TRIM_TEMPLATES } from "../../shop/trimTemplates";
import { createGuard } from "../guard";
import { showForm } from "../openForm";

const W = { clientWritable: true } as const;

export function openTrimEditor(player: Player, key: string, back: () => void, notice?: string): void {
    const guard = createGuard(player, key);
    if (!guard.check()) return;
    const reopen = (msg?: string): void => openTrimEditor(player, key, back, msg);
    showForm(player, () => {
        const name = new ObservableString("", W);
        const status = new StatusLabel();
        if (notice) status.set(t(notice));
        const form = guard.attach(new CustomForm(player, t("bus.shopedit.trims.title")));
        form.label(t("bus.shopedit.trims.intro")).label(t("bus.shopedit.trims.limits"));

        const trims = getShop().trims;
        if (trims.length === 0) form.label(t("bus.shopedit.trims.none"));
        trims.forEach((tpl) => {
            form.button(
                { rawtext: [t("bus.shopedit.trim_delete"), raw(` ${tpl.name}`)] },
                guard.click(() => {
                    if (trimInUse(tpl.id)) {
                        status.set(t("bus.shopedit.trim_in_use"));
                        return;
                    }
                    deleteTrimTemplate(tpl.id);
                    form.close();
                    reopen("bus.shopedit.trim_deleted");
                })
            );
        });

        form.divider().header(t("bus.shopedit.trim_capture"));
        if (trims.length < MAX_TRIM_TEMPLATES) {
            form.label(t("bus.shopedit.trim_capture.desc"))
                .textField(t("bus.shopedit.trim_name"), name)
                .button(
                    t("bus.shopedit.trim_capture_btn"),
                    guard.click(() => {
                        const label = name.getData();
                        system.run(() => {
                            const res = captureTrimFromHand(player, label);
                            if (res === "ok") {
                                form.close();
                                reopen("bus.shopedit.trim_captured");
                            } else status.set(t(`bus.shopedit.trim_capture.${res}`));
                        });
                    })
                );
        }
        form.spacer().label(status.message, { visible: status.visible }).spacer().button(t("bus.common.back"), () => {
            form.close();
            back();
        });
        return form.closeButton();
    });
}
