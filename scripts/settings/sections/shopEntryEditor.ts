import { StatusLabel } from "../../shop/statusLabel";
import { system, type Player } from "@minecraft/server";
import { CustomForm, ObservableBoolean, ObservableString } from "@minecraft/server-ui";
import { raw, t } from "../../core/lang";
import { giveSpec, heldStack, prettyName } from "../../shop/shopItems";
import { defaultPriceFor, findCategory, flushSave, newId, scheduleSave } from "../../shop/shopStore";
import type { ItemSpec, KitContent, Sellable, ShopCategory, ShopItem, ShopKit } from "../../shop/shopTypes";
import { createGuard, type SettingsGuard } from "../guard";
import { showForm } from "../openForm";
import { addSpecControls, toInt } from "./shopSpecControls";

const W = { clientWritable: true } as const;
export const KEY = "bus:shop";

type Back = () => void;

function text(form: CustomForm, guard: SettingsGuard, label: string, value: string, apply: (v: string) => void, desc?: string): void {
    const o = new ObservableString(value, W);
    guard.on(o, (v: string) => {
        apply(v);
        scheduleSave();
    });
    form.textField(t(label), o, desc ? { description: t(desc) } : undefined);
}

function intField(form: CustomForm, guard: SettingsGuard, label: string, value: number | undefined, min: number, max: number, apply: (n: number | undefined) => void, desc?: string): void {
    const o = new ObservableString(value === undefined ? "" : String(value), W);
    guard.on(o, (v: string) => {
        if (v.trim() === "") apply(undefined);
        else {
            const n = toInt(v, min, max);
            if (n === undefined) return;
            apply(n);
        }
        scheduleSave();
    });
    form.textField(t(label), o, desc ? { description: t(desc) } : undefined);
}

/** Two-step delete: the first click asks, the second click deletes. */
function deleteButton(form: CustomForm, guard: SettingsGuard, status: StatusLabel, doDelete: () => void): void {
    let armed = false;
    form.button(
        t("bus.shopedit.delete"),
        guard.click(() => {
            if (!armed) {
                armed = true;
                status.set(t("bus.shopedit.delete_confirm"));
                return;
            }
            doDelete();
        })
    );
}

function leave(form: CustomForm, back: Back): () => void {
    return () => {
        flushSave();
        form.close();
        back();
    };
}

// ---- buy item -------------------------------------------------------------------------------

export function openItemEditor(player: Player, categoryId: string, itemId: string, back: Back): void {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;
    const cat = findCategory(categoryId);
    const item = cat?.items.find((x) => x.id === itemId);
    if (!cat || !item) return back();
    const reopen = (): void => openItemEditor(player, categoryId, itemId, back);
    showForm(player, () => {
        const status = new StatusLabel();
        const form = guard.attach(new CustomForm(player, t("bus.shopedit.item.title")));
        text(form, guard, "bus.shopedit.name", item.name, (v) => (item.name = v.trim() || item.name));
        intField(form, guard, "bus.shopedit.price", item.price, 0, 2_000_000_000, (n) => (item.price = n), "bus.shopedit.price.desc");
        form.label(t("bus.shopedit.price.default", defaultPriceFor(cat)));
        intField(form, guard, "bus.shopedit.unit_amount", item.unitAmount, 1, 2304, (n) => (item.unitAmount = n), "bus.shopedit.unit_amount.desc");
        text(form, guard, "bus.shopedit.lore", item.lore ?? "", (v) => (item.lore = v.trim() || undefined));
        text(form, guard, "bus.shopedit.icon", item.icon ?? "", (v) => (item.icon = v.trim() || undefined), "bus.shopedit.icon.desc");
        intField(form, guard, "bus.shopedit.min_qty", item.minQuantity, 1, 2304, (n) => (item.minQuantity = n));
        intField(form, guard, "bus.shopedit.max_qty", item.maxQuantity, 1, 2304, (n) => (item.maxQuantity = n));
        intField(form, guard, "bus.shopedit.step", item.step, 1, 2304, (n) => (item.step = n));
        addSpecControls(form, guard, player, item, reopen, status, (info) => (item.name = info.name));
        testButton(form, guard, player, item, status);
        form.divider();
        deleteButton(form, guard, status, () => {
            cat.items = cat.items.filter((x) => x.id !== itemId);
            flushSave();
            form.close();
            back();
        });
        form.spacer().label(status.message, { visible: status.visible }).spacer().button(t("bus.common.back"), leave(form, back));
        return form.closeButton();
    });
}

function testButton(form: CustomForm, guard: SettingsGuard, player: Player, spec: ItemSpec, status: StatusLabel): void {
    form.button(
        t("bus.shopedit.test"),
        guard.click(() =>
            system.run(() => {
                flushSave();
                const err = giveSpec(player, spec, 1);
                status.set(err && !err.ok ? t(`bus.shop.error.${err.reason}`) : t("bus.shopedit.test_ok"));
            })
        ),
        { tooltip: t("bus.shopedit.test.desc") }
    );
}

// ---- sell item ------------------------------------------------------------------------------

export function openSellableEditor(player: Player, categoryId: string, sellId: string, back: Back): void {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;
    const cat = findCategory(categoryId);
    const s = cat?.sellables.find((x) => x.id === sellId);
    if (!cat || !s) return back();
    showForm(player, () => {
        const status = new StatusLabel();
        const form = guard.attach(new CustomForm(player, t("bus.shopedit.sellable.title")));
        text(form, guard, "bus.shopedit.name", s.name, (v) => (s.name = v.trim() || s.name));
        text(form, guard, "bus.shopedit.item_id", s.itemId, (v) => {
            const x = v.trim();
            if (x) s.itemId = x.includes(":") ? x : `minecraft:${x}`;
        }, "bus.shopedit.item_id.desc");
        form.button(
            t("bus.shopedit.use_held"),
            guard.click(() =>
                system.run(() => {
                    const held = heldStack(player);
                    if (!held) {
                        status.set(t("bus.shopedit.use_held.none"));
                        return;
                    }
                    s.itemId = held.typeId;
                    s.name = prettyName(held.typeId);
                    flushSave();
                    form.close();
                    openSellableEditor(player, categoryId, sellId, back);
                })
            ),
            { tooltip: t("bus.shopedit.use_held.sell_desc") }
        );
        intField(form, guard, "bus.shopedit.sell_price", s.sellPrice, 0, 2_000_000_000, (n) => (s.sellPrice = n), "bus.shopedit.sell_price.desc");
        form.label(t("bus.shopedit.price.default", defaultPriceFor(cat)));
        intField(form, guard, "bus.shopedit.unit_amount", s.unitAmount, 1, 2304, (n) => (s.unitAmount = n), "bus.shopedit.unit_amount_sell.desc");
        text(form, guard, "bus.shopedit.icon", s.icon ?? "", (v) => (s.icon = v.trim() || undefined), "bus.shopedit.icon.desc");
        intField(form, guard, "bus.shopedit.max_sell", s.maxSellPerTransaction, 1, 2304, (n) => (s.maxSellPerTransaction = n));
        form.divider();
        deleteButton(form, guard, status, () => {
            cat.sellables = cat.sellables.filter((x) => x.id !== sellId);
            flushSave();
            form.close();
            back();
        });
        form.spacer().label(status.message, { visible: status.visible }).spacer().button(t("bus.common.back"), leave(form, back));
        return form.closeButton();
    });
}

// ---- kit ------------------------------------------------------------------------------------

export function openKitEditor(player: Player, categoryId: string, kitId: string, back: Back): void {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;
    const cat = findCategory(categoryId);
    const kit = cat?.kits.find((x) => x.id === kitId);
    if (!cat || !kit) return back();
    const reopen = (): void => openKitEditor(player, categoryId, kitId, back);
    showForm(player, () => {
        const status = new StatusLabel();
        const form = guard.attach(new CustomForm(player, t("bus.shopedit.kit.title")));
        text(form, guard, "bus.shopedit.name", kit.name, (v) => (kit.name = v.trim() || kit.name));
        intField(form, guard, "bus.shopedit.price", kit.price, 0, 2_000_000_000, (n) => (kit.price = n ?? kit.price), "bus.shopedit.price.desc");
        text(form, guard, "bus.shopedit.lore", kit.lore ?? "", (v) => (kit.lore = v.trim() || undefined));
        text(form, guard, "bus.shopedit.icon", kit.icon ?? "", (v) => (kit.icon = v.trim() || undefined), "bus.shopedit.icon.desc");
        const allow = new ObservableBoolean(kit.allowQuantity === true, W);
        guard.on(allow, (v: boolean) => {
            kit.allowQuantity = v;
            scheduleSave();
        });
        form.toggle(t("bus.shopedit.kit_allow_qty"), allow);
        intField(form, guard, "bus.shopedit.kit_max_qty", kit.maxQuantity, 1, 64, (n) => (kit.maxQuantity = n));

        form.header(t("bus.shopedit.kit_contents"));
        if (kit.contents.length === 0) form.label(t("bus.shopedit.kit_contents.none"));
        kit.contents.forEach((c, i) => {
            form.button(
                { rawtext: [raw(`${c.amount}x `), raw(c.itemId.replace("minecraft:", ""))] },
                guard.click(() => {
                    flushSave();
                    form.close();
                    openKitContentEditor(player, categoryId, kitId, i, reopen);
                })
            );
        });
        if (kit.contents.length < 36) {
            form.button(
                t("bus.shopedit.kit_add_content"),
                guard.click(() => {
                    kit.contents.push({ itemId: "minecraft:stone", amount: 1 });
                    flushSave();
                    form.close();
                    reopen();
                })
            );
        }
        form.divider();
        deleteButton(form, guard, status, () => {
            cat.kits = cat.kits.filter((x) => x.id !== kitId);
            flushSave();
            form.close();
            back();
        });
        form.spacer().label(status.message, { visible: status.visible }).spacer().button(t("bus.common.back"), leave(form, back));
        return form.closeButton();
    });
}

function openKitContentEditor(player: Player, categoryId: string, kitId: string, index: number, back: Back): void {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;
    const kit = findCategory(categoryId)?.kits.find((x) => x.id === kitId);
    const c: KitContent | undefined = kit?.contents[index];
    if (!kit || !c) return back();
    const reopen = (): void => openKitContentEditor(player, categoryId, kitId, index, back);
    showForm(player, () => {
        const status = new StatusLabel();
        const form = guard.attach(new CustomForm(player, t("bus.shopedit.kit_content.title")));
        intField(form, guard, "bus.shopedit.amount", c.amount, 1, 2304, (n) => (c.amount = n ?? c.amount));
        addSpecControls(form, guard, player, c, reopen, status);
        testButton(form, guard, player, { ...c }, status);
        form.divider();
        deleteButton(form, guard, status, () => {
            kit.contents.splice(index, 1);
            flushSave();
            form.close();
            back();
        });
        form.spacer().label(status.message, { visible: status.visible }).spacer().button(t("bus.common.back"), leave(form, back));
        return form.closeButton();
    });
}

// ---- creating entries -----------------------------------------------------------------------

export function addItem(cat: ShopCategory): ShopItem {
    const i: ShopItem = { id: newId("i"), itemId: "minecraft:stone", name: "Stone" };
    cat.items.push(i);
    scheduleSave();
    return i;
}
export function addKit(cat: ShopCategory): ShopKit {
    const k: ShopKit = { id: newId("k"), name: "New Kit", price: 10, contents: [] };
    cat.kits.push(k);
    scheduleSave();
    return k;
}
export function addSellable(cat: ShopCategory): Sellable {
    const s: Sellable = { id: newId("s"), itemId: "minecraft:coal", name: "Coal" };
    cat.sellables.push(s);
    scheduleSave();
    return s;
}
