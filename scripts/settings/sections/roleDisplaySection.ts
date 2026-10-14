import type { Player } from "@minecraft/server";
import { CustomForm, ObservableBoolean, ObservableNumber, ObservableString } from "@minecraft/server-ui";
import { t } from "../../core/lang";
import { isChatSupported } from "../../roles/chatSupport";
import {
    getDisplaySettings,
    setDisplaySettings,
    type MultiRoleMode,
    type NametagPosition,
} from "../../roles/displaySettings";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

const KEY = "bus:role_display";
const WRITABLE = { clientWritable: true } as const;
const POSITIONS: NametagPosition[] = ["above", "below", "beside"];
const MODES: MultiRoleMode[] = ["highest", "all"];

registerSettingsSection({
    id: KEY,
    title: t("bus.section.role_display.title"),
    description: t("bus.section.role_display.desc"),
    order: 20,
    open: (player, back) => openDisplay(player, back),
});

function openDisplay(player: Player, back: () => void): void {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;

    showForm(player, () => {
        const s = getDisplaySettings();
        // chatSend is pre-release: without Beta APIs chat options are shown switched off and locked.
        const chatOk = isChatSupported();
        const chatLocked = new ObservableBoolean(!chatOk);
        const chatVisible = new ObservableBoolean(chatOk);

        const chatEnabled = new ObservableBoolean(chatOk && s.chatEnabled, WRITABLE);
        const chatFormat = new ObservableString(s.chatFormat, WRITABLE);
        const nametagEnabled = new ObservableBoolean(s.nametagEnabled, WRITABLE);
        const position = new ObservableNumber(Math.max(0, POSITIONS.indexOf(s.nametagPosition)), WRITABLE);
        const mode = new ObservableNumber(Math.max(0, MODES.indexOf(s.multiRoleMode)), WRITABLE);
        const showAll = new ObservableBoolean(s.multiRoleMode === "all");
        const separator = new ObservableString(s.separator, WRITABLE);
        const nickChat = new ObservableBoolean(chatOk && s.nicknameInChat, WRITABLE);
        const nickTag = new ObservableBoolean(s.nicknameInNametag, WRITABLE);

        // Settings save instantly, but only while the player still has access.
        if (chatOk) {
            guard.on(chatEnabled, (v: boolean) => setDisplaySettings({ chatEnabled: v }));
            guard.on(nickChat, (v: boolean) => setDisplaySettings({ nicknameInChat: v }));
        }
        guard.on(chatFormat, (v: string) => setDisplaySettings({ chatFormat: v }));
        guard.on(nametagEnabled, (v: boolean) => setDisplaySettings({ nametagEnabled: v }));
        guard.on(position, (i: number) => setDisplaySettings({ nametagPosition: POSITIONS[i] ?? "above" }));
        guard.on(mode, (i: number) => {
            showAll.setData(i === 1);
            setDisplaySettings({ multiRoleMode: MODES[i] ?? "highest" });
        });
        guard.on(separator, (v: string) => setDisplaySettings({ separator: v }));
        guard.on(nickTag, (v: boolean) => setDisplaySettings({ nicknameInNametag: v }));

        const form = guard.attach(new CustomForm(player, t("bus.section.role_display.title")));

        form.header(t("bus.display.chat.header"));
        if (!chatOk) form.label(t("bus.display.chat.unsupported"));
        form.toggle(t("bus.display.chat.toggle"), chatEnabled, {
            description: t(chatOk ? "bus.display.chat.toggle.desc" : "bus.display.chat.unsupported"),
            disabled: chatLocked,
        })
            .textField(t("bus.display.chat.format"), chatFormat, {
                description: t("bus.display.chat.format.desc"),
                visible: chatVisible,
            })
            .divider();

        form.header(t("bus.display.nametag.header"))
            .toggle(t("bus.display.nametag.toggle"), nametagEnabled, {
                description: t("bus.display.nametag.toggle.desc"),
            })
            .dropdown(
                t("bus.display.nametag.position"),
                position,
                [
                    { label: t("bus.display.nametag.above"), value: 0 },
                    { label: t("bus.display.nametag.below"), value: 1 },
                    { label: t("bus.display.nametag.beside"), value: 2 },
                ],
                { visible: nametagEnabled }
            )
            .divider();

        form.header(t("bus.display.multi.header"))
            .dropdown(t("bus.display.multi.show"), mode, [
                { label: t("bus.display.multi.highest"), value: 0 },
                { label: t("bus.display.multi.all"), value: 1 },
            ])
            .textField(t("bus.display.multi.separator"), separator, { visible: showAll })
            .divider();

        form.header(t("bus.display.nick.header"))
            .toggle(t("bus.display.nick.chat"), nickChat, {
                description: t(chatOk ? "bus.display.nick.chat.desc" : "bus.display.chat.unsupported"),
                disabled: chatLocked,
            })
            .toggle(t("bus.display.nick.tag"), nickTag)
            .divider();

        form.button(t("bus.common.back"), () => {
            form.close();
            back();
        });
        return form.closeButton();
    });
}
