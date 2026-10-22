import { system, world } from "@minecraft/server";
import { isRecord } from "../core/storage";
import { t } from "../core/lang";
import { registerShareable } from "../share/shareRegistry";
import type {
    ItemSpec,
    KitContent,
    Sellable,
    ShopCategory,
    ShopConfig,
    ShopEnchant,
    ShopPotion,
    ShopItem,
    ShopKit,
    ShopTree,
    TrimStorage,
    TrimTemplate,
} from "./shopTypes";

const KEY = "bus:shop";
const STORAGE_KEY = "bus:shop_trim_storage";
const CHUNK = 12000;
const MAX_CATEGORIES = 200;
const MAX_ENTRIES = 600;
const MAX_TRIMS = 40;
export const DEFAULT_OBJECTIVE = "bus.currency";
export const OBJECTIVE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

export const MAX_PRICE = 2_000_000_000;

// ---- helpers -------------------------------------------------------------------------------

export function newId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function emptyCategory(id: string, name: string): ShopCategory {
    return { id, name, children: [], items: [], kits: [], sellables: [] };
}

function defaultConfig(): ShopConfig {
    return {
        currencyName: "Coins",
        modernUI: false,
        objectiveName: DEFAULT_OBJECTIVE,
        openMenu: false,
        buyRoot: emptyCategory("buy", "Shop"),
        sellRoot: emptyCategory("sell", "Sell Shop"),
        trims: [],
    };
}

const str = (v: unknown, max: number, fallback = ""): string => (typeof v === "string" ? v.slice(0, max) : fallback);
const num = (v: unknown, min: number, max: number, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const optNum = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : undefined;
const optStr = (v: unknown, max: number): string | undefined => (typeof v === "string" && v ? v.slice(0, max) : undefined);

function normEnchants(v: unknown): ShopEnchant[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const out: ShopEnchant[] = [];
    for (const e of v) {
        if (!isRecord(e) || typeof e.id !== "string" || !e.id) continue;
        out.push({ id: e.id.replace(/^minecraft:/, "").slice(0, 48), level: num(e.level, 1, 255, 1) });
        if (out.length >= 12) break;
    }
    return out.length ? out : undefined;
}

function normPotion(v: unknown): ShopPotion | undefined {
    if (!isRecord(v) || typeof v.effect !== "string" || !v.effect) return undefined;
    return { effect: v.effect.slice(0, 64) };
}

function itemId(v: unknown): string {
    const s = str(v, 96).trim();
    return s.includes(":") ? s : s ? `minecraft:${s}` : "minecraft:stone";
}

class Counter {
    categories = 0;
    entries = 0;
}

function normItem(v: unknown, c: Counter): ShopItem | undefined {
    if (!isRecord(v) || ++c.entries > MAX_ENTRIES) return undefined;
    return {
        id: str(v.id, 40) || newId("i"),
        itemId: itemId(v.itemId),
        name: str(v.name, 60, "Item"),
        price: optNum(v.price, 0, MAX_PRICE),
        unitAmount: optNum(v.unitAmount, 1, 2304),
        icon: optStr(v.icon, 120),
        lore: optStr(v.lore, 200),
        minQuantity: optNum(v.minQuantity, 1, 2304),
        maxQuantity: optNum(v.maxQuantity, 1, 2304),
        step: optNum(v.step, 1, 2304),
        enchants: normEnchants(v.enchants),
        potion: normPotion(v.potion),
        trimId: optStr(v.trimId, 40),
        trimName: optStr(v.trimName, 60),
        nameTag: optStr(v.nameTag, 60),
    };
}

function normContent(v: unknown): KitContent | undefined {
    if (!isRecord(v)) return undefined;
    return {
        itemId: itemId(v.itemId),
        amount: num(v.amount, 1, 2304, 1),
        enchants: normEnchants(v.enchants),
        potion: normPotion(v.potion),
        trimId: optStr(v.trimId, 40),
        trimName: optStr(v.trimName, 60),
        nameTag: optStr(v.nameTag, 60),
    };
}

function normKit(v: unknown, c: Counter): ShopKit | undefined {
    if (!isRecord(v) || ++c.entries > MAX_ENTRIES) return undefined;
    const contents = (Array.isArray(v.contents) ? v.contents : [])
        .slice(0, 36)
        .map(normContent)
        .filter((x): x is KitContent => !!x);
    return {
        id: str(v.id, 40) || newId("k"),
        name: str(v.name, 60, "Kit"),
        price: num(v.price, 0, MAX_PRICE, 1),
        icon: optStr(v.icon, 120),
        lore: optStr(v.lore, 200),
        contents,
        allowQuantity: v.allowQuantity === true,
        maxQuantity: optNum(v.maxQuantity, 1, 64),
    };
}

function normSellable(v: unknown, c: Counter): Sellable | undefined {
    if (!isRecord(v) || ++c.entries > MAX_ENTRIES) return undefined;
    return {
        id: str(v.id, 40) || newId("s"),
        itemId: itemId(v.itemId),
        name: str(v.name, 60, "Item"),
        sellPrice: optNum(v.sellPrice, 0, MAX_PRICE),
        unitAmount: optNum(v.unitAmount, 1, 2304),
        icon: optStr(v.icon, 120),
        maxSellPerTransaction: optNum(v.maxSellPerTransaction, 1, 2304),
    };
}

function list<T>(v: unknown, fn: (x: unknown) => T | undefined): T[] {
    return (Array.isArray(v) ? v : []).map(fn).filter((x): x is T => x !== undefined);
}

function normCategory(v: unknown, c: Counter, depth: number, fallbackId: string, fallbackName: string): ShopCategory {
    const r = isRecord(v) ? v : {};
    const cat = emptyCategory(str(r.id, 40) || fallbackId, str(r.name, 60, fallbackName));
    cat.icon = optStr(r.icon, 120);
    cat.defaultPrice = optNum(r.defaultPrice, 0, MAX_PRICE);
    cat.items = list(r.items, (x) => normItem(x, c));
    cat.kits = list(r.kits, (x) => normKit(x, c));
    cat.sellables = list(r.sellables, (x) => normSellable(x, c));
    if (depth < 8) {
        cat.children = list(r.children, (x) => (++c.categories > MAX_CATEGORIES ? undefined : normCategory(x, c, depth + 1, newId("c"), "Category")));
    }
    return cat;
}

/** Makes every id unique (imported data may repeat them). */
function dedupeIds(root: ShopCategory, seen: Set<string>): void {
    const fix = (o: { id: string }, prefix: string): void => {
        if (seen.has(o.id)) o.id = newId(prefix);
        seen.add(o.id);
    };
    fix(root, "c");
    for (const i of root.items) fix(i, "i");
    for (const k of root.kits) fix(k, "k");
    for (const s of root.sellables) fix(s, "s");
    for (const ch of root.children) dedupeIds(ch, seen);
}

export function normalizeShop(v: unknown): ShopConfig {
    const d = defaultConfig();
    if (!isRecord(v)) return d;
    const c = new Counter();
    const cfg: ShopConfig = {
        currencyName: str(v.currencyName, 24, d.currencyName) || d.currencyName,
        modernUI: v.modernUI === true,
        objectiveName: typeof v.objectiveName === "string" && OBJECTIVE_PATTERN.test(v.objectiveName) ? v.objectiveName : DEFAULT_OBJECTIVE,
        openMenu: v.openMenu === true,
        buyRoot: normCategory(v.buyRoot, c, 0, "buy", "Shop"),
        sellRoot: normCategory(v.sellRoot, c, 0, "sell", "Sell Shop"),
        trims: list(v.trims, (x): TrimTemplate | undefined =>
            isRecord(x) && typeof x.id === "string" && typeof x.slot === "number"
                ? { id: x.id.slice(0, 40), name: str(x.name, 60, "Trim"), slot: num(x.slot, 0, 40, 0) }
                : undefined
        ).slice(0, MAX_TRIMS),
    };
    cfg.buyRoot.id = "buy";
    cfg.sellRoot.id = "sell";
    dedupeIds(cfg.buyRoot, new Set());
    cfg.buyRoot.id = "buy";
    dedupeIds(cfg.sellRoot, new Set());
    cfg.sellRoot.id = "sell";
    return cfg;
}

// ---- persistence (chunked, a world dynamic property string is size-limited) ---------------

let cache: ShopConfig | undefined;
const listeners = new Set<() => void>();

export function onShopChanged(fn: () => void): void {
    listeners.add(fn);
}

function load(): ShopConfig {
    try {
        const count = world.getDynamicProperty(KEY);
        if (typeof count !== "number") return defaultConfig();
        let text = "";
        for (let i = 0; i < count; i++) {
            const part = world.getDynamicProperty(`${KEY}:${i}`);
            if (typeof part !== "string") return defaultConfig();
            text += part;
        }
        return normalizeShop(JSON.parse(text));
    } catch {
        return defaultConfig();
    }
}

export function getShop(): ShopConfig {
    return (cache ??= load());
}

/** Call after mutating the object returned by getShop(). */
export function saveShop(): void {
    const cfg = getShop();
    const text = JSON.stringify(cfg);
    const parts = Math.ceil(text.length / CHUNK);
    const previous = world.getDynamicProperty(KEY);
    for (let i = 0; i < parts; i++) world.setDynamicProperty(`${KEY}:${i}`, text.slice(i * CHUNK, (i + 1) * CHUNK));
    if (typeof previous === "number") {
        for (let i = parts; i < previous; i++) world.setDynamicProperty(`${KEY}:${i}`, undefined);
    }
    world.setDynamicProperty(KEY, parts);
    for (const fn of listeners) fn();
}

let saveTimer: number | undefined;

/** Debounced save for text fields that fire on every keystroke. Call flushSave() when leaving a screen. */
export function scheduleSave(): void {
    if (saveTimer !== undefined) system.clearRun(saveTimer);
    saveTimer = system.runTimeout(() => {
        saveTimer = undefined;
        saveShop();
    }, 20);
}

export function flushSave(): void {
    if (saveTimer === undefined) return;
    system.clearRun(saveTimer);
    saveTimer = undefined;
    saveShop();
}

export function replaceShop(cfg: ShopConfig): void {
    cache = cfg;
    saveShop();
}

export function getTrimStorage(): TrimStorage | undefined {
    const raw = world.getDynamicProperty(STORAGE_KEY);
    if (typeof raw !== "string") return undefined;
    try {
        const v: unknown = JSON.parse(raw);
        if (isRecord(v) && typeof v.dimensionId === "string" && typeof v.entityId === "string") return v as unknown as TrimStorage;
    } catch {
        // fall through
    }
    return undefined;
}

export function setTrimStorage(s: TrimStorage | undefined): void {
    world.setDynamicProperty(STORAGE_KEY, s ? JSON.stringify(s) : undefined);
}

// ---- tree helpers --------------------------------------------------------------------------

export function getRoot(tree: ShopTree): ShopCategory {
    return tree === "buy" ? getShop().buyRoot : getShop().sellRoot;
}

export function findCategory(id: string, from?: ShopCategory): ShopCategory | undefined {
    const search = (c: ShopCategory): ShopCategory | undefined => {
        if (c.id === id) return c;
        for (const ch of c.children) {
            const f = search(ch);
            if (f) return f;
        }
        return undefined;
    };
    if (from) return search(from);
    return search(getShop().buyRoot) ?? search(getShop().sellRoot);
}

export function treeOf(id: string): ShopTree | undefined {
    if (findCategory(id, getShop().buyRoot)) return "buy";
    if (findCategory(id, getShop().sellRoot)) return "sell";
    return undefined;
}

export function findParent(root: ShopCategory, id: string): ShopCategory | undefined {
    for (const ch of root.children) {
        if (ch.id === id) return root;
        const f = findParent(ch, id);
        if (f) return f;
    }
    return undefined;
}

/** Referenced trim ids no longer present are dropped when saving/using; this lists who uses a trim. */
export function trimInUse(id: string): boolean {
    const used = (c: ShopCategory): boolean =>
        c.items.some((i) => i.trimId === id) ||
        c.kits.some((k) => k.contents.some((x) => x.trimId === id)) ||
        c.children.some(used);
    return used(getShop().buyRoot);
}

// ---- shareable -----------------------------------------------------------------------------
// Trim templates live in the world (a real item inside a storage entity), so a share code carries
// the trim *names* only. Imported items that reference a trim this world doesn't have simply give
// the plain armor until the trim is captured again under the same name.

registerShareable({
    id: KEY,
    label: t("bus.share.shop"),
    export: () => {
        const cfg = getShop();
        const names = new Map(cfg.trims.map((x) => [x.id, x.name]));
        const strip = <T extends ItemSpec>(o: T): T => {
            const { trimId, ...rest } = o;
            return (trimId && names.has(trimId) ? { ...rest, trimName: names.get(trimId) } : rest) as T;
        };
        const walk = (c: ShopCategory): unknown => ({
            ...c,
            items: c.items.map(strip),
            kits: c.kits.map((k) => ({ ...k, contents: k.contents.map(strip) })),
            children: c.children.map(walk),
        });
        return { currencyName: cfg.currencyName, modernUI: cfg.modernUI, objectiveName: cfg.objectiveName, openMenu: cfg.openMenu, buyRoot: walk(cfg.buyRoot), sellRoot: walk(cfg.sellRoot) };
    },
    import: (data) => {
        if (!isRecord(data) || !isRecord(data.buyRoot) || !isRecord(data.sellRoot)) return t("bus.share.shop.invalid");
        const incoming = normalizeShop(data); // validates and cleans everything before anything is applied
        const current = getShop();
        const byName = new Map(current.trims.map((x) => [x.name, x.id]));
        const relink = (o: ItemSpec): void => {
            o.trimId = o.trimName ? byName.get(o.trimName) : undefined;
            delete o.trimName;
        };
        const walk = (c: ShopCategory): void => {
            c.items.forEach(relink);
            c.kits.forEach((k) => k.contents.forEach(relink));
            c.children.forEach(walk);
        };
        walk(incoming.buyRoot);
        incoming.trims = current.trims;
        replaceShop(incoming);
        return undefined;
    },
});

const ID_PATTERN = /^[a-z0-9_-]{1,40}$/;
export type RenameResult = "ok" | "invalid" | "taken" | "reserved";

/** Renames a non-root category's id (the one used by /scriptevent bus:shop <id>). */
export function renameCategoryId(oldId: string, newIdText: string): RenameResult {
    const next = newIdText.trim().toLowerCase();
    if (!ID_PATTERN.test(next)) return "invalid";
    if (next === "sell" || next === "buy") return "reserved";
    if (next === oldId) return "ok";
    if (findCategory(next)) return "taken";
    const cat = findCategory(oldId);
    if (!cat || oldId === "buy" || oldId === "sell") return "invalid";
    cat.id = next;
    saveShop();
    return "ok";
}

function pathTo(from: ShopCategory, id: string): ShopCategory[] | undefined {
    if (from.id === id) return [from];
    for (const ch of from.children) {
        const p = pathTo(ch, id);
        if (p) return [from, ...p];
    }
    return undefined;
}

/** The default price that applies in a category: its own, else the nearest ancestor's, else 1. */
export function defaultPriceFor(cat: ShopCategory): number {
    const path = pathTo(getShop().buyRoot, cat.id) ?? pathTo(getShop().sellRoot, cat.id) ?? [cat];
    for (let i = path.length - 1; i >= 0; i--) {
        const p = path[i].defaultPrice;
        if (p !== undefined) return p;
    }
    return 1;
}

export const itemPrice = (cat: ShopCategory, item: ShopItem): number => item.price ?? defaultPriceFor(cat);
export const sellPriceOf = (cat: ShopCategory, s: Sellable): number => s.sellPrice ?? defaultPriceFor(cat);
export const unitOf = (x: { unitAmount?: number }): number => x.unitAmount ?? 1;
