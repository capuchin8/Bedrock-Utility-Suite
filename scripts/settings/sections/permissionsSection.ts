import type { Player } from "@minecraft/server";
import type { UIRawMessage } from "@minecraft/server-ui";
import { CustomForm, ObservableBoolean } from "@minecraft/server-ui";
import { getCommandCeiling } from "../../commands/busCommand";
import { isCommandAllowedInCombat, setCommandAllowedInCombat } from "../../combat/combatStore";
import { raw, t } from "../../core/lang";
import {
    getPermissionDef,
    getPermissionDefs,
    getPolicy,
    resetPolicy,
    setPolicy,
    type PermissionDefinition,
    type PermissionPolicy,
} from "../../permissions/permissionStore";
import { getRoles } from "../../roles/roleStore";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

const KEY = "bus:permissions";
const WRITABLE = { clientWritable: true } as const;
const CATEGORIES = ["menu", "command", "feature"] as const;

// Only the owner can change who has access to what.
registerSettingsSection({
    id: KEY,
    title: t("bus.section.permissions.title"),
    description: t("bus.section.permissions.desc"),
    order: 900,
    ownerOnly: true,
    open: (player, back) => permissionsHome(player, back),
});

function summary(key: string): UIRawMessage {
    const policy = getPolicy(key);
    if (policy.everyone) return t("bus.perm.summary.everyone");
    const parts: UIRawMessage[] = [];
    if (policy.operators) parts.push(t("bus.perm.summary.operators"));
    if (policy.roles.length) parts.push(t("bus.perm.summary.roles", policy.roles.length));
    if (parts.length === 0) return t("bus.perm.summary.owner_only");
    return { rawtext: parts.flatMap((p, i) => (i === 0 ? [p] : [raw(", "), p])) };
}

function permissionsHome(player: Player, back: () => void): void {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;
    showForm(player, () => {
        const form = guard.attach(new CustomForm(player, t("bus.section.permissions.title")));
        form.label(t("bus.perm.intro"));

        const defs = getPermissionDefs().filter((d) => !d.ownerOnly);
        for (const category of CATEGORIES) {
            const items = defs.filter((d) => d.category === category);
            if (items.length === 0) continue;
            form.header(t(`bus.perm.category.${category}`));
            for (const def of items) {
                form.button(
                    { rawtext: [def.label, raw(" - "), summary(def.key)] },
                    guard.click(() => {
                        form.close();
                        editPermission(player, def.key, () => permissionsHome(player, back));
                    }),
                    def.description ? { tooltip: def.description } : undefined
                );
            }
        }

        form.divider();
        form.button(t("bus.common.back"), () => {
            form.close();
            back();
        });
        return form.closeButton();
    });
}

function ceilingNotice(def: PermissionDefinition): UIRawMessage | undefined {
    if (def.category !== "command") return undefined;
    const ceiling = getCommandCeiling(def.key);
    // 0 = Any: everyone can see the command, so BUS roles fully decide.
    if (ceiling === undefined || ceiling === 0) return undefined;
    return t(ceiling === "disabled" ? "bus.perm.ceiling.disabled" : `bus.perm.ceiling.${ceiling}`);
}

function editPermission(player: Player, key: string, back: () => void): void {
    const def = getPermissionDef(key);
    if (!def) {
        back();
        return;
    }
    const guard = createGuard(player, KEY);
    const roles = Object.entries(getRoles());

    showForm(player, () => {
        const current = getPolicy(key);
        const state: PermissionPolicy = { everyone: current.everyone, operators: current.operators, roles: [...current.roles] };
        const everyone = new ObservableBoolean(state.everyone, WRITABLE);
        const operators = new ObservableBoolean(state.operators, WRITABLE);
        const restricted = new ObservableBoolean(!state.everyone);

        guard.on(everyone, (v: boolean) => {
            state.everyone = v;
            restricted.setData(!v);
            setPolicy(key, state);
        });
        guard.on(operators, (v: boolean) => {
            state.operators = v;
            setPolicy(key, state);
        });

        const form = guard.attach(new CustomForm(player, def.label));
        if (def.description) form.label(def.description);
        const notice = ceilingNotice(def);
        if (notice) form.label(notice);

        form.toggle(t("bus.perm.everyone"), everyone, { description: t("bus.perm.everyone.desc") });
        form.toggle(t("bus.perm.operators"), operators, {
            description: t("bus.perm.operators.desc"),
            visible: restricted,
        });

        // Commands can be blocked while a player is in combat (see Settings > Combat).
        if (def.category === "command") {
            const inCombat = new ObservableBoolean(isCommandAllowedInCombat(key), WRITABLE);
            guard.on(inCombat, (v: boolean) => setCommandAllowedInCombat(key, v));
            form.toggle(t("bus.perm.combat"), inCombat, { description: t("bus.perm.combat.desc") });
        }

        if (roles.length === 0) form.label(t("bus.perm.no_roles"));
        for (const [id, role] of roles) {
            const has = new ObservableBoolean(state.roles.includes(id), WRITABLE);
            guard.on(has, (v: boolean) => {
                state.roles = v ? [...new Set([...state.roles, id])] : state.roles.filter((r) => r !== id);
                setPolicy(key, state);
            });
            // Role toggles only show while "Everyone" is off.
            form.toggle(raw(role.name), has, { visible: restricted });
        }

        form.divider();
        form.button(
            t("bus.perm.reset"),
            guard.click(() => {
                resetPolicy(key);
                form.close();
                back();
            })
        );
        form.button(t("bus.common.back"), () => {
            form.close();
            back();
        });
        return form;
    });
}
