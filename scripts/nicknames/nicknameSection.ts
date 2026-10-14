import { world, type Player } from "@minecraft/server";
import { CustomForm, ObservableNumber, ObservableString, ObservableUIRawMessage } from "@minecraft/server-ui";
import { raw, t } from "../core/lang";
import { canUse, isOperator, registerPermission } from "../permissions/permissionStore";
import { createGuard } from "../settings/guard";
import { showForm } from "../settings/openForm";
import { registerSettingsSection } from "../settings/registry";
import { checkNickname, getNickname, MAX_NICKNAME_LENGTH, setNickname } from "./nicknameStore";

const KEY = "bus:nicknames";
const EDIT_OTHERS = "bus:nickname.edit_others";

registerPermission({
    key: EDIT_OTHERS,
    label: t("bus.perm.nickname_edit_others.name"),
    description: t("bus.perm.nickname_edit_others.desc"),
    category: "feature",
    defaultEveryone: false,
});

// This section's id doubles as the permission for the menu AND the /bus:nickname command.
// Turn "everyone" off in Permissions to make nicknames role-only.
registerSettingsSection({
    id: KEY,
    title: t("bus.section.nicknames.title"),
    description: t("bus.section.nicknames.desc"),
    order: 30,
    defaultEveryone: true,
    open: (player, back) => nicknameForm(player, back),
});

function nicknameForm(player: Player, back: () => void): void {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;

    const targets = canUse(player, EDIT_OTHERS) ? world.getAllPlayers() : [player];
    const selfIndex = Math.max(0, targets.findIndex((p) => p.id === player.id));

    showForm(player, () => {
        const targetIndex = new ObservableNumber(selfIndex, { clientWritable: true });
        const input = new ObservableString(getNickname(targets[selfIndex]) ?? "", { clientWritable: true });
        const status = new ObservableUIRawMessage(raw(""));

        const form = guard.attach(new CustomForm(player, t("bus.section.nicknames.title")));

        if (targets.length > 1) {
            form.dropdown(t("bus.nickname.player"), targetIndex, targets.map((p, i) => ({ label: raw(p.name), value: i })));
            guard.on(targetIndex, (i: number) => {
                const target = targets[i];
                if (target?.isValid) input.setData(getNickname(target) ?? "");
            });
        }

        // Editing someone else needs the permission at the moment of saving, not just when the menu opened.
        const resolveTarget = (): Player | undefined => {
            const target = targets[targetIndex.getData()];
            if (!target?.isValid) {
                status.setData(t("bus.nickname.offline"));
                return undefined;
            }
            if (target.id !== player.id && !canUse(player, EDIT_OTHERS)) {
                status.setData(t("bus.nickname.no_edit_others"));
                return undefined;
            }
            return target;
        };

        form.textField(t("bus.nickname.field"), input, {
            description: t("bus.nickname.field.desc", MAX_NICKNAME_LENGTH),
        })
            .label(status)
            .button(
                t("bus.nickname.save"),
                guard.click(() => {
                    const target = resolveTarget();
                    if (!target) return;
                    const check = checkNickname(target, input.getData(), isOperator(player));
                    if (!check.ok) {
                        status.setData(check.error);
                        return;
                    }
                    setNickname(target, check.value);
                    status.setData(t("bus.nickname.saved", check.value));
                })
            )
            .button(
                t("bus.nickname.reset"),
                guard.click(() => {
                    const target = resolveTarget();
                    if (!target) return;
                    setNickname(target, undefined);
                    input.setData("");
                    status.setData(t("bus.nickname.cleared"));
                })
            )
            .button(t("bus.common.back"), () => {
                form.close();
                back();
            });

        return form;
    });
}
