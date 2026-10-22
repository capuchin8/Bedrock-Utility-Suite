import { ItemStack, system, type Player } from "@minecraft/server";
import { ActionFormData, CustomForm, type ActionFormResponse } from "@minecraft/server-ui";
import { showForm } from "../settings/openForm";
import { raw, t } from "../core/lang";
import { canUse } from "../permissions/permissionStore";
import { addBalance, getBalance, tryRemoveBalance } from "./shopEconomy";
import { getIconFor } from "./shopIcons";
import { giveSpec, potionName, prettyName } from "./shopItems";
import { openQuantityForm, type PurchaseResult } from "./shopQuantityForm";
import { findCategory, getRoot, getShop, itemPrice, sellPriceOf, unitOf } from "./shopStore";
import type { Sellable, ShopCategory, ShopItem, ShopKit, ShopTree } from "./shopTypes";

export const SHOP_PERMISSION = "bus:shop_use";

type Raw = ReturnType<typeof t>;
const priceText = (price: number, unit: number, cur: string): Raw =>
    unit > 1 ? t("bus.shop.price_per", price, cur, unit) : t("bus.shop.price", price, cur);
const sellText = (price: number, unit: number, cur: string): Raw =>
    unit > 1 ? t("bus.shop.sell_price_per", price, cur, unit) : t("bus.shop.sell_price", price, cur);
const tint = (code: string, m: Raw | { text: string }): { rawtext: unknown[] } => ({ rawtext: [raw(code), m] });

function allowed(player: Player): boolean {
    return canUse(player, SHOP_PERMISSION);
}

/**
 * Entry point for the command, scriptevents and everything else. With no tree, the shop either opens
 * the buy shop or shows the Buy/Sell chooser, depending on the "ask first" setting.
 */
export function openShop(player: Player, tree?: ShopTree, categoryId?: string): void {
    if (!allowed(player)) {
        player.sendMessage(t("bus.command.no_permission"));
        return;
    }
    if (!tree) {
        if (getShop().openMenu) return openChooser(player);
        tree = "buy";
    }
    const root = getRoot(tree);
    const cat = categoryId ? findCategory(categoryId, root) : root;
    openCategory(player, tree, cat ?? root);
}

function openChooser(player: Player): void {
    if (getShop().modernUI) {
        showForm(player, () => {
            const form = new CustomForm(player, t("bus.shop.menu.title"));
            const go = (tree: ShopTree) => (): void => {
                if (!allowed(player)) return;
                form.close();
                system.run(() => openCategory(player, tree, getRoot(tree)));
            };
            form.button(t("bus.shop.menu.buy"), go("buy")).button(t("bus.shop.menu.sell"), go("sell"));
            return form.closeButton();
        });
        return;
    }
    const cfg = getShop();
    new ActionFormData()
        .title(t("bus.shop.menu.title"))
        .button({ rawtext: [raw("§a"), t("bus.shop.menu.buy")] }, cfg.buyRoot.icon || undefined)
        .button({ rawtext: [raw("§6"), t("bus.shop.menu.sell")] }, cfg.sellRoot.icon || undefined)
        .show(player)
        .then((r) => {
            if (r.canceled || r.selection === undefined || !allowed(player)) return;
            const tree: ShopTree = r.selection === 0 ? "buy" : "sell";
            openCategory(player, tree, getRoot(tree));
        })
        .catch((e) => console.warn(`[bus:shop] ${e}`));
}

function parentOf(root: ShopCategory, id: string): ShopCategory | undefined {
    for (const c of root.children) {
        if (c.id === id) return root;
        const f = parentOf(c, id);
        if (f) return f;
    }
    return undefined;
}

function openCategory(player: Player, tree: ShopTree, cat: ShopCategory): void {
    if (getShop().modernUI) openCategoryModern(player, tree, cat);
    else openCategoryClassic(player, tree, cat);
}

/**
 * Modern style: DDUI form. Cleaner, but it can't show icons and § colours don't render on buttons
 * (so entries are plain text).
 */
function openCategoryModern(player: Player, tree: ShopTree, cat: ShopCategory): void {
    const root = getRoot(tree);
    const cfg = getShop();
    const go = (form: CustomForm, fn: () => void): (() => void) => () => {
        if (!allowed(player)) return;
        form.close();
        system.run(fn);
    };
    showForm(player, () => {
        const form = new CustomForm(player, raw(cat.name));
        form.label(t("bus.shop.balance", getBalance(player), cfg.currencyName)).spacer();
        for (const c of cat.children) form.button(raw(c.name), go(form, () => openCategory(player, tree, c)));
        if (tree === "buy") {
            for (const i of cat.items) {
                form.button({ rawtext: [raw(`${i.name} - `), priceText(itemPrice(cat, i), unitOf(i), cfg.currencyName)] }, go(form, () => openItem(player, tree, cat, i)));
            }
            for (const k of cat.kits) {
                form.button({ rawtext: [raw(`${k.name} `), t("bus.shop.kit_tag"), raw(" - "), t("bus.shop.price", k.price, cfg.currencyName)] }, go(form, () => openKit(player, tree, cat, k)));
            }
        } else {
            for (const s of cat.sellables) {
                form.button({ rawtext: [raw(`${s.name} - `), sellText(sellPriceOf(cat, s), unitOf(s), cfg.currencyName)] }, go(form, () => openSellable(player, cat, s)));
            }
        }
        if (cat !== root) {
            const parent = parentOf(root, cat.id) ?? root;
            form.spacer().button(t("bus.common.back"), go(form, () => openCategory(player, tree, parent)));
        }
        return form.closeButton();
    });
}

function openCategoryClassic(player: Player, tree: ShopTree, cat: ShopCategory): void {
    const root = getRoot(tree);
    const cfg = getShop();
    const form = new ActionFormData().title(raw(cat.name));
    form.body({ rawtext: [raw("§e"), t("bus.shop.balance", getBalance(player), cfg.currencyName)] });

    type Action = () => void;
    const actions: Action[] = [];
    const add = (label: unknown, icon: string | undefined, fn: Action): void => {
        form.button(label as never, icon || undefined);
        actions.push(fn);
    };

    for (const c of cat.children) add(tint("§b", raw(c.name)), c.icon ? getIconFor("", c.icon) : undefined, () => openCategory(player, tree, c));

    if (tree === "buy") {
        for (const item of cat.items) {
            add({ rawtext: [raw(`${item.name}\n§a`), priceText(itemPrice(cat, item), unitOf(item), cfg.currencyName)] }, getIconFor(item.itemId, item.icon, item.potion), () => openItem(player, tree, cat, item));
        }
        for (const kit of cat.kits) {
            add({ rawtext: [raw(`${kit.name}\n§6`), t("bus.shop.price", kit.price, cfg.currencyName), raw(" §e"), t("bus.shop.kit_tag")] }, kit.icon ? getIconFor("", kit.icon) : getIconFor(kit.contents[0]?.itemId ?? "minecraft:chest", undefined, kit.contents[0]?.potion), () => openKit(player, tree, cat, kit));
        }
    } else {
        for (const s of cat.sellables) {
            add({ rawtext: [raw(`${s.name}\n§a`), sellText(sellPriceOf(cat, s), unitOf(s), cfg.currencyName)] }, getIconFor(s.itemId, s.icon), () => openSellable(player, cat, s));
        }
    }

    if (cat !== root) {
        const parent = parentOf(root, cat.id) ?? root;
        add(t("bus.common.back"), undefined, () => openCategory(player, tree, parent));
    }

    form.show(player).then((r: ActionFormResponse) => {
        if (r.canceled || r.selection === undefined) return;
        if (!allowed(player)) return;
        actions[r.selection]?.();
    }).catch((e) => console.warn(`[bus:shop] ${e}`));
}

// ---- buying ---------------------------------------------------------------------------------

function failFor(reason: "item" | "enchant" | "trim"): PurchaseResult {
    return { ok: false, message: tint("§c", t(`bus.shop.error.${reason}`)) as never };
}

function buy(player: Player, price: number, give: () => ReturnType<typeof giveSpec>, quantity: number, items = quantity): PurchaseResult {
    if (!allowed(player)) return { ok: false, message: t("bus.settings.access_revoked") };
    const cost = price * quantity;
    const cur = getShop().currencyName;
    if (getBalance(player) < cost) return { ok: false, message: tint("§c", t("bus.shop.error.funds", cost, cur)) as never };
    if (!tryRemoveBalance(player, cost)) return { ok: false, message: tint("§c", t("bus.shop.error.funds", cost, cur)) as never };
    const err = give();
    if (err && !err.ok) {
        addBalance(player, cost); // refund
        return failFor(err.reason);
    }
    return { ok: true, amount: cost, message: tint("§a", t("bus.shop.bought", items, cost, cur)) as never };
}

function openItem(player: Player, tree: ShopTree, cat: ShopCategory, item: ShopItem): void {
    const cfg = getShop();
    const min = item.minQuantity ?? 1;
    const max = Math.max(min, item.maxQuantity ?? 64);
    const price = itemPrice(cat, item);
    const unit = unitOf(item);
    openQuantityForm(player, {
        title: raw(item.name),
        details: item.lore ? raw(item.lore) : undefined,
        totalKey: "bus.shop.total_cost",
        totalUnitsKey: "bus.shop.total_cost_units",
        unitAmount: unit,
        sessionKey: "bus.shop.session_bought",
        confirmKey: "bus.shop.buy",
        currency: cfg.currencyName,
        unitPrice: price,
        min,
        max,
        step: item.step,
        onConfirm: (q) => buy(player, price, () => giveSpec(player, item, q * unit), q, q * unit),
        onBack: () => system.run(() => openCategory(player, tree, cat)),
    });
}

/** "Contains:" followed by one line per item, e.g. "1x Diamond Sword (sharpness 3)". */
function kitContents(kit: ShopKit): Raw {
    const lines = kit.contents.map((c) => {
        let name = c.nameTag ?? prettyName(c.itemId);
        if (c.potion) name = c.nameTag ?? potionName(c.itemId, c.potion.effect);
        if (c.enchants?.length) name += ` (${c.enchants.map((e) => `${e.id} ${e.level}`).join(", ")})`;
        return `${c.amount}x ${name}`;
    });
    const contents = [t("bus.shop.kit_contains"), raw(`\n${lines.join("\n") || "-"}`)];
    return { rawtext: kit.lore ? [raw(`${kit.lore}\n\n`), ...contents] : contents };
}

function openKit(player: Player, tree: ShopTree, cat: ShopCategory, kit: ShopKit): void {
    const cfg = getShop();
    const max = kit.allowQuantity ? Math.max(1, kit.maxQuantity ?? 10) : 1;
    openQuantityForm(player, {
        title: raw(kit.name),
        details: kitContents(kit),
        totalKey: "bus.shop.total_cost",
        sessionKey: "bus.shop.session_bought",
        confirmKey: "bus.shop.buy",
        currency: cfg.currencyName,
        unitPrice: kit.price,
        min: 1,
        max,
        onConfirm: (q) =>
            buy(
                player,
                kit.price,
                () => {
                    for (const c of kit.contents) {
                        const err = giveSpec(player, c, c.amount * q);
                        if (err) return err;
                    }
                    return undefined;
                },
                q
            ),
        onBack: () => system.run(() => openCategory(player, tree, cat)),
    });
}

// ---- selling --------------------------------------------------------------------------------

export function countItem(player: Player, itemId: string): number {
    const c = player.getComponent("minecraft:inventory")?.container;
    if (!c) return 0;
    let n = 0;
    for (let i = 0; i < c.size; i++) {
        const it = c.getItem(i);
        if (it?.typeId === itemId) n += it.amount;
    }
    return n;
}

function removeItems(player: Player, itemId: string, amount: number): void {
    const c = player.getComponent("minecraft:inventory")?.container;
    if (!c) return;
    let left = amount;
    for (let i = 0; i < c.size && left > 0; i++) {
        const it = c.getItem(i);
        if (it?.typeId !== itemId) continue;
        const take = Math.min(left, it.amount);
        left -= take;
        if (take === it.amount) c.setItem(i);
        else {
            const rest: ItemStack = it;
            rest.amount = it.amount - take;
            c.setItem(i, rest);
        }
    }
}

function openSellable(player: Player, cat: ShopCategory, s: Sellable): void {
    const cfg = getShop();
    const have = countItem(player, s.itemId);
    const unit = unitOf(s);
    const price = sellPriceOf(cat, s);
    const cap = Math.floor(Math.min(have, s.maxSellPerTransaction ?? 2304) / unit);
    if (cap < 1) {
        if (cfg.modernUI) {
            showForm(player, () => {
                const form = new CustomForm(player, raw(s.name));
                form.label(t("bus.shop.error.none_to_sell")).spacer().button(t("bus.common.back"), () => {
                    form.close();
                    system.run(() => openCategory(player, "sell", cat));
                });
                return form.closeButton();
            });
            return;
        }
        new ActionFormData()
            .title(raw(s.name))
            .body(t("bus.shop.error.none_to_sell"))
            .button(t("bus.common.back"))
            .show(player)
            .then(() => openCategory(player, "sell", cat))
            .catch(() => undefined);
        return;
    }
    openQuantityForm(player, {
        title: raw(s.name),
        totalKey: "bus.shop.total_earn",
        totalUnitsKey: "bus.shop.total_earn_units",
        unitAmount: unit,
        sessionKey: "bus.shop.session_sold",
        confirmKey: "bus.shop.sell",
        currency: cfg.currencyName,
        unitPrice: price,
        min: 1,
        max: cap,
        extra: { label: t("bus.shop.sell_all", cap * unit), quantity: cap },
        onConfirm: (q) => {
            if (!allowed(player)) return { ok: false, message: t("bus.settings.access_revoked") };
            if (countItem(player, s.itemId) < q * unit) return { ok: false, message: tint("§c", t("bus.shop.error.not_enough")) as never };
            removeItems(player, s.itemId, q * unit);
            const earned = q * price;
            addBalance(player, earned);
            return { ok: true, amount: earned, message: tint("§a", t("bus.shop.sold", q * unit, earned, cfg.currencyName)) as never };
        },
        onBack: () => system.run(() => openCategory(player, "sell", cat)),
    });
}
