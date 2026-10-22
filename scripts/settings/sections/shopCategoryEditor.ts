import { StatusLabel } from "../../shop/statusLabel";
import { system, type Player } from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";
import { raw, t } from "../../core/lang";
import { describeStack, hotbarStacks } from "../../shop/shopItems";
import { autoCapture } from "../../shop/trimTemplates";
import { emptyCategory, findCategory, findParent, flushSave, getRoot, itemPrice, newId, renameCategoryId, scheduleSave, sellPriceOf } from "../../shop/shopStore";
import type { ShopTree } from "../../shop/shopTypes";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { KEY, addItem, addKit, addSellable, openItemEditor, openKitEditor, openSellableEditor } from "./shopEntryEditor";

const W = { clientWritable: true } as const;

export function openCategoryEditor(player: Player, tree: ShopTree, categoryId: string, back: () => void): void {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;
    const root = getRoot(tree);
    const cat = findCategory(categoryId, root);
    if (!cat) return back();
    const isRoot = cat === root;
    const reopen = (): void => openCategoryEditor(player, tree, categoryId, back);
    const go = (form: CustomForm, fn: () => void): (() => void) =>
        guard.click(() => {
            flushSave();
            form.close();
            fn();
        });

    showForm(player, () => {
        const status = new StatusLabel();
        const form = guard.attach(new CustomForm(player, t(tree === "buy" ? "bus.shopedit.buy.title" : "bus.shopedit.sell.title")));

        const name = new ObservableString(cat.name, W);
        guard.on(name, (v: string) => {
            cat.name = v.trim() || cat.name;
            scheduleSave();
        });
        form.textField(t("bus.shopedit.cat_name"), name);
        const icon = new ObservableString(cat.icon ?? "", W);
        guard.on(icon, (v: string) => {
            cat.icon = v.trim() || undefined;
            scheduleSave();
        });
        form.textField(t("bus.shopedit.cat_icon"), icon, { description: t(isRoot ? "bus.shopedit.root_icon.desc" : "bus.shopedit.cat_icon.desc") });
        const dp = new ObservableString(cat.defaultPrice === undefined ? "" : String(cat.defaultPrice), W);
        guard.on(dp, (v: string) => {
            if (v.trim() === "") cat.defaultPrice = undefined;
            else {
                const n = Number.parseInt(v.trim(), 10);
                if (!Number.isFinite(n) || n < 0 || n > 2_000_000_000) return;
                cat.defaultPrice = n;
            }
            scheduleSave();
        });
        form.textField(t("bus.shopedit.default_price"), dp, { description: t("bus.shopedit.default_price.desc") });
        form.label(t("bus.shopedit.cat_id.desc", cat.id, cat.id));
        if (!isRoot) {
            const newCatId = new ObservableString(cat.id, W);
            form.textField(t("bus.shopedit.cat_id"), newCatId, { description: t("bus.shopedit.cat_id.rename_desc") }).button(
                t("bus.shopedit.cat_id.apply"),
                guard.click(() => {
                    const res = renameCategoryId(cat.id, newCatId.getData());
                    if (res !== "ok") {
                        status.set(t(`bus.shopedit.cat_id.${res}`));
                        return;
                    }
                    flushSave();
                    form.close();
                    openCategoryEditor(player, tree, newCatId.getData().trim().toLowerCase(), back);
                })
            );
        }

        form.header(t("bus.shopedit.subcats"));
        for (const c of cat.children) form.button(raw(c.name), go(form, () => openCategoryEditor(player, tree, c.id, reopen)));
        form.button(
            t("bus.shopedit.add_category"),
            go(form, () => {
                const c = emptyCategory(newId("c"), "New Category");
                cat.children.push(c);
                flushSave();
                openCategoryEditor(player, tree, c.id, reopen);
            })
        );

        if (tree === "buy") {
            form.header(t("bus.shopedit.items"));
            for (const i of cat.items) {
                form.button({ rawtext: [raw(`${i.name} - ${itemPrice(cat, i)}`)] }, go(form, () => openItemEditor(player, cat.id, i.id, reopen)));
            }
            form.button(t("bus.shopedit.add_item"), go(form, () => openItemEditor(player, cat.id, addItem(cat).id, reopen)));
            form.button(
                t("bus.shopedit.import_hotbar"),
                guard.click(() =>
                    system.run(() => {
                        const stacks = hotbarStacks(player);
                        if (!stacks.length) {
                            status.set(t("bus.shopedit.import_hotbar.empty"));
                            return;
                        }
                        for (const st of stacks) {
                            const info = describeStack(st);
                            cat.items.push({ id: newId("i"), itemId: info.itemId, name: info.name, enchants: info.enchants, potion: info.potion, trimId: autoCapture(player, st) });
                        }
                        flushSave();
                        form.close();
                        reopen();
                    })
                ),
                { tooltip: t("bus.shopedit.import_hotbar.desc") }
            );

            form.header(t("bus.shopedit.kits"));
            for (const k of cat.kits) form.button({ rawtext: [raw(`${k.name} - ${k.price}`)] }, go(form, () => openKitEditor(player, cat.id, k.id, reopen)));
            form.button(t("bus.shopedit.add_kit"), go(form, () => openKitEditor(player, cat.id, addKit(cat).id, reopen)));
        } else {
            form.header(t("bus.shopedit.sellables"));
            for (const s of cat.sellables) {
                form.button({ rawtext: [raw(`${s.name} - ${sellPriceOf(cat, s)}`)] }, go(form, () => openSellableEditor(player, cat.id, s.id, reopen)));
            }
            form.button(t("bus.shopedit.add_sellable"), go(form, () => openSellableEditor(player, cat.id, addSellable(cat).id, reopen)));
            form.button(
                t("bus.shopedit.import_hotbar"),
                guard.click(() =>
                    system.run(() => {
                        const stacks = hotbarStacks(player).filter((st) => !st.getComponent("minecraft:potion"));
                        if (!stacks.length) {
                            status.set(t("bus.shopedit.import_hotbar.empty_sell"));
                            return;
                        }
                        for (const st of stacks) {
                            if (cat.sellables.some((x) => x.itemId === st.typeId)) continue;
                            cat.sellables.push({ id: newId("s"), itemId: st.typeId, name: describeStack(st).name });
                        }
                        flushSave();
                        form.close();
                        reopen();
                    })
                ),
                { tooltip: t("bus.shopedit.import_hotbar.sell_desc") }
            );
        }

        if (!isRoot) {
            form.divider();
            let armed = false;
            form.button(
                t("bus.shopedit.delete_category"),
                guard.click(() => {
                    if (!armed) {
                        armed = true;
                        status.set(t("bus.shopedit.delete_category_confirm"));
                        return;
                    }
                    const parent = findParent(root, cat.id);
                    if (parent) parent.children = parent.children.filter((c) => c.id !== cat.id);
                    flushSave();
                    form.close();
                    back();
                })
            );
        }
        form.spacer().label(status.message, { visible: status.visible }).spacer().button(t("bus.common.back"), () => {
            flushSave();
            form.close();
            back();
        });
        return form.closeButton();
    });
}
