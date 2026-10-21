import { MinecraftEnchantmentTypes } from "@minecraft/vanilla-data";
import { Potions, system, type Player } from "@minecraft/server";
import { CustomForm, ObservableNumber, ObservableString } from "@minecraft/server-ui";
import { raw, t } from "../../core/lang";
import { describeStack, heldStack, type HeldInfo } from "../../shop/shopItems";
import { getShop, scheduleSave } from "../../shop/shopStore";
import type { StatusLabel } from "../../shop/statusLabel";
import type { ItemSpec } from "../../shop/shopTypes";
import { trimTemplateTypeId } from "../../shop/trimTemplates";
import type { SettingsGuard } from "../guard";

const W = { clientWritable: true } as const;
export const ENCHANT_IDS: string[] = Object.values(MinecraftEnchantmentTypes).map((v) => String(v).replace(/^minecraft:/, ""));
export const MAX_ENCHANTS = 8;

export function toInt(v: string, min: number, max: number): number | undefined {
    const n = Number.parseInt(v.trim(), 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

/**
 * Adds the shared controls for something that becomes an ItemStack: item id, name tag, enchantments
 * (works for minecraft:enchanted_book too) and an armor trim template. `reopen` rebuilds the screen
 * (controls can't be added after show()).
 */
export function addSpecControls(
    form: CustomForm,
    guard: SettingsGuard,
    player: Player,
    spec: ItemSpec,
    reopen: () => void,
    status: StatusLabel,
    onHeld?: (info: HeldInfo) => void
): void {
    form.button(
        t("bus.shopedit.use_held"),
        guard.click(() =>
            system.run(() => {
                const held = heldStack(player);
                if (!held) {
                    status.set(t("bus.shopedit.use_held.none"));
                    return;
                }
                const info = describeStack(held);
                spec.itemId = info.itemId;
                spec.enchants = info.enchants;
                spec.potion = info.potion;
                spec.trimId = undefined;
                onHeld?.(info);
                scheduleSave();
                form.close();
                reopen();
            })
        ),
        { tooltip: t("bus.shopedit.use_held.desc") }
    );

    const id = new ObservableString(spec.itemId, W);
    guard.on(id, (v: string) => {
        const s = v.trim();
        if (!s) return;
        spec.itemId = s.includes(":") ? s : `minecraft:${s}`;
        scheduleSave();
    });
    form.textField(t("bus.shopedit.item_id"), id, { description: t("bus.shopedit.item_id.desc") });

    const tag = new ObservableString(spec.nameTag ?? "", W);
    guard.on(tag, (v: string) => {
        spec.nameTag = v.trim() || undefined;
        scheduleSave();
    });
    form.textField(t("bus.shopedit.name_tag"), tag, { description: t("bus.shopedit.name_tag.desc") });

    // Enchantments / enchanted book contents
    form.header(t("bus.shopedit.enchants")).label(t("bus.shopedit.enchants.desc"));
    (spec.enchants ?? []).forEach((e, i) => {
        const idx = Math.max(0, ENCHANT_IDS.indexOf(e.id));
        const pick = new ObservableNumber(idx, W);
        guard.on(pick, (v: number) => {
            e.id = ENCHANT_IDS[Math.round(v)] ?? e.id;
            scheduleSave();
        });
        form.dropdown(
            t("bus.shopedit.enchant_n", i + 1),
            pick,
            ENCHANT_IDS.map((name, n) => ({ label: raw(name), value: n }))
        );
        const level = new ObservableString(String(e.level), W);
        guard.on(level, (v: string) => {
            const n = toInt(v, 1, 255);
            if (n !== undefined) {
                e.level = n;
                scheduleSave();
            }
        });
        form.textField(t("bus.shopedit.enchant_level", i + 1), level);
        form.button(
            t("bus.shopedit.enchant_remove", i + 1),
            guard.click(() => {
                spec.enchants = (spec.enchants ?? []).filter((_x, n) => n !== i);
                if (!spec.enchants.length) spec.enchants = undefined;
                scheduleSave();
                form.close();
                reopen();
            })
        );
    });
    if ((spec.enchants?.length ?? 0) < MAX_ENCHANTS) {
        form.button(
            t("bus.shopedit.enchant_add"),
            guard.click(() => {
                (spec.enchants ??= []).push({ id: ENCHANT_IDS[0] ?? "sharpness", level: 1 });
                scheduleSave();
                form.close();
                reopen();
            })
        );
    }

    // Potion
    form.header(t("bus.shopedit.potion")).label(t("bus.shopedit.potion.desc"));
    let effects: string[] = [];
    let deliveries: string[] = [];
    try {
        effects = Potions.getAllEffectTypes().map((e) => e.id);
        deliveries = Potions.getAllDeliveryTypes().map((d) => d.id);
    } catch {
        // potion registry unavailable
    }
    if (effects.length && deliveries.length) {
        const effIdx = new ObservableNumber(spec.potion ? effects.indexOf(spec.potion.effect) + 1 : 0, W);
        const delIdx = new ObservableNumber(Math.max(0, spec.potion ? deliveries.indexOf(spec.potion.delivery) : 0), W);
        const apply = (): void => {
            const e = Math.round(effIdx.getData());
            if (e <= 0) {
                spec.potion = undefined;
            } else {
                spec.potion = { effect: effects[e - 1], delivery: deliveries[Math.max(0, Math.round(delIdx.getData()))] };
                try {
                    spec.itemId = Potions.resolve(spec.potion.effect, spec.potion.delivery).typeId;
                } catch {
                    // keep the previous item id
                }
            }
            scheduleSave();
        };
        guard.on(effIdx, apply);
        guard.on(delIdx, apply);
        form.dropdown(t("bus.shopedit.potion_effect"), effIdx, [
            { label: t("bus.shopedit.potion_none"), value: 0 },
            ...effects.map((id, n) => ({ label: raw(id), value: n + 1 })),
        ]);
        form.dropdown(t("bus.shopedit.potion_delivery"), delIdx, deliveries.map((id, n) => ({ label: raw(id), value: n })));
    }

    // Armor trim
    const trims = getShop().trims;
    form.header(t("bus.shopedit.trim"));
    if (trims.length === 0) {
        form.label(t("bus.shopedit.trim.none"));
        return;
    }
    form.label(t("bus.shopedit.trim.desc"));
    const current = Math.max(0, trims.findIndex((x) => x.id === spec.trimId) + 1);
    const trimPick = new ObservableNumber(current, W);
    guard.on(trimPick, (v: number) => {
        const n = Math.round(v);
        const tpl = n > 0 ? trims[n - 1] : undefined;
        spec.trimId = tpl?.id;
        if (tpl) {
            const type = trimTemplateTypeId(tpl.id);
            if (type) spec.itemId = type;
        }
        scheduleSave();
        system.run(() => {
            form.close();
            reopen();
        });
    });
    form.dropdown(t("bus.shopedit.trim_pick"), trimPick, [
        { label: t("bus.shopedit.trim_none"), value: 0 },
        ...trims.map((x, n) => ({ label: raw(x.name), value: n + 1 })),
    ]);
}
