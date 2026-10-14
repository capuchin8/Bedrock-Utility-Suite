import type { Player } from "@minecraft/server";
import { CustomForm, ObservableBoolean, ObservableString } from "@minecraft/server-ui";
import { t } from "../../core/lang";
import { MAX_EVENT_COMMANDS, getEventCommands, saveEventCommands, type EventTrigger } from "../../events/eventCommands";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

const KEY = "bus:event_commands";
const WRITABLE = { clientWritable: true } as const;
const TRIGGERS: EventTrigger[] = ["firstJoin", "join", "leave"];
const LANG_NAME: Record<EventTrigger, string> = { firstJoin: "first_join", join: "join", leave: "leave" };

// These run with the game's command powers, so only the owner can edit them by default:
// anyone who could edit them could effectively run any command.
registerSettingsSection({
    id: KEY,
    title: t("bus.section.event_commands.title"),
    description: t("bus.section.event_commands.desc"),
    order: 50,
    ownerOnly: true,
    open: (player, back) => eventHome(player, back),
});

function eventHome(player: Player, back: () => void): void {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;
    showForm(player, () => {
        const form = guard.attach(new CustomForm(player, t("bus.section.event_commands.title")));
        form.label(t("bus.events.intro"));
        const c = getEventCommands();
        for (const trigger of TRIGGERS) {
            form.button(
                t(`bus.events.${LANG_NAME[trigger]}.title`),
                guard.click(() => {
                    form.close();
                    editTrigger(player, trigger, () => eventHome(player, back));
                }),
                { tooltip: t("bus.events.count", c[trigger].filter((x) => x.trim()).length) }
            );
        }
        form.divider().button(t("bus.common.back"), () => {
            form.close();
            back();
        });
        return form.closeButton();
    });
}

function editTrigger(player: Player, trigger: EventTrigger, back: () => void): void {
    const guard = createGuard(player, KEY);
    const reopen = (): void => editTrigger(player, trigger, back);

    showForm(player, () => {
        const c = getEventCommands();
        const form = guard.attach(new CustomForm(player, t(`bus.events.${LANG_NAME[trigger]}.title`)));
        form.label(t(`bus.events.${LANG_NAME[trigger]}.desc`));

        if (trigger === "join") {
            const excludeFirst = new ObservableBoolean(c.joinExcludesFirst, WRITABLE);
            guard.on(excludeFirst, (v: boolean) => saveEventCommands({ ...getEventCommands(), joinExcludesFirst: v }));
            form.toggle(t("bus.events.exclude_first"), excludeFirst, { description: t("bus.events.exclude_first.desc") });
        }

        if (c[trigger].length === 0) form.label(t("bus.events.none"));
        c[trigger].forEach((command, i) => {
            const field = new ObservableString(command, WRITABLE);
            guard.on(field, (v: string) => {
                const all = getEventCommands();
                const list = [...all[trigger]];
                list[i] = v;
                saveEventCommands({ ...all, [trigger]: list });
            });
            form.textField(t("bus.events.command_n", i + 1), field);
            form.button(
                t("bus.events.remove_n", i + 1),
                guard.click(() => {
                    const all = getEventCommands();
                    saveEventCommands({ ...all, [trigger]: all[trigger].filter((_x, idx) => idx !== i) });
                    form.close();
                    reopen();
                })
            );
        });

        if (c[trigger].length < MAX_EVENT_COMMANDS) {
            form.button(
                t("bus.events.add"),
                guard.click(() => {
                    const all = getEventCommands();
                    saveEventCommands({ ...all, [trigger]: [...all[trigger], ""] });
                    form.close();
                    reopen();
                })
            );
        }

        form.divider().button(t("bus.common.back"), () => {
            form.close();
            back();
        });
        return form.closeButton();
    });
}
