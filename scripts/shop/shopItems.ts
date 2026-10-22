import { EnchantmentType, ItemStack, Potions, type Player } from "@minecraft/server";
import type { ItemSpec, ShopEnchant, ShopPotion } from "./shopTypes";
import { getTrimTemplateStack } from "./trimTemplates";

export type BuildResult = { ok: true; stack: ItemStack } | { ok: false; reason: "item" | "enchant" | "trim" };

/** Builds one stack (amount <= max stack) from a spec. Not for restricted-execution contexts. */
export function buildStack(spec: ItemSpec, amount: number): BuildResult {
    let stack: ItemStack;
    try {
        const delivery = potionDelivery(spec.itemId);
        if (spec.potion && delivery) {
            // Potions.resolve builds the right item (potion / splash / lingering) with the effect.
            stack = Potions.resolve(spec.potion.effect, delivery);
            stack.amount = amount;
        } else if (spec.trimId) {
            const tpl = getTrimTemplateStack(spec.trimId);
            if (!tpl) return { ok: false, reason: "trim" };
            stack = tpl;
            stack.amount = amount;
        } else {
            stack = new ItemStack(spec.itemId, amount);
        }
    } catch {
        return { ok: false, reason: "item" };
    }
    if (spec.nameTag) stack.nameTag = spec.nameTag;
    if (spec.enchants?.length) {
        // For enchanted books this is expected to write the stored enchantments (unverified in
        // 2.11.0-beta; the editor's Test button reports a failure here instead of giving a plain book).
        const comp = stack.getComponent("minecraft:enchantable");
        if (!comp) return { ok: false, reason: "enchant" };
        try {
            for (const e of spec.enchants) comp.addEnchantment({ type: new EnchantmentType(e.id), level: e.level });
        } catch {
            return { ok: false, reason: "enchant" };
        }
    }
    return { ok: true, stack };
}

/** Gives `total` of a spec, split into max-size stacks; leftovers that don't fit drop at the player's feet. */
export function giveSpec(player: Player, spec: ItemSpec, total: number): BuildResult | undefined {
    const first = buildStack(spec, 1);
    if (!first.ok) return first;
    const max = first.stack.maxAmount;
    const container = player.getComponent("minecraft:inventory")?.container;
    let left = total;
    while (left > 0) {
        const n = Math.min(max, left);
        const built = buildStack(spec, n);
        if (!built.ok) return built;
        const rest = container?.addItem(built.stack);
        if (rest) player.dimension.spawnItem(rest, player.location);
        left -= n;
    }
    return undefined;
}

const DELIVERY: Record<string, string> = {
    "minecraft:potion": "Consume",
    "minecraft:splash_potion": "ThrownSplash",
    "minecraft:lingering_potion": "ThrownLingering",
};

export const isPotionItem = (itemId: string): boolean => itemId in DELIVERY;

/** Potion delivery type id for a potion item id (undefined for anything else). */
export const potionDelivery = (itemId: string): string | undefined => DELIVERY[itemId];

const titleCase = (s: string): string =>
    s.split("_").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** "Potion of Healing", "Splash Potion of Leaping (Extended)", "Awkward Potion", ... */
export function potionName(itemId: string, effectId: string): string {
    const base = itemId === "minecraft:splash_potion" ? "Splash Potion" : itemId === "minecraft:lingering_potion" ? "Lingering Potion" : "Potion";
    let e = effectId.replace(/^[a-z0-9_.-]+:/, "");
    let suffix = "";
    if (e.startsWith("long_")) {
        e = e.slice(5);
        suffix = " (Extended)";
    } else if (e.startsWith("strong_")) {
        e = e.slice(7);
        suffix = " II";
    }
    if (e === "water") return base === "Potion" ? "Water Bottle" : `${base} of Water`;
    if (e === "awkward" || e === "mundane" || e === "thick") return `${titleCase(e)} ${base}`;
    return `${base} of ${titleCase(e)}${suffix}`;
}

export function prettyName(itemId: string): string {
    return itemId
        .replace(/^[a-z0-9_.-]+:/, "")
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

export interface HeldInfo {
    itemId: string;
    name: string;
    enchants?: ShopEnchant[];
    potion?: ShopPotion;
}

/** Reads what a stack is: id, enchantments (stored ones on books, if the API reports them) and potion. */
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** "Sharpness V Enchanted Book" for a book holding exactly one enchantment. */
export function enchantedBookName(e: ShopEnchant): string {
    return `${titleCase(e.id)} ${ROMAN[e.level] || e.level} Enchanted Book`;
}

export function describeStack(stack: ItemStack): HeldInfo {
    const info: HeldInfo = { itemId: stack.typeId, name: prettyName(stack.typeId) };
    try {
        const list = stack.getComponent("minecraft:enchantable")?.getEnchantments() ?? [];
        if (list.length) info.enchants = list.slice(0, 12).map((e) => ({ id: e.type.id.replace(/^minecraft:/, ""), level: e.level }));
    } catch {
        // no enchantments readable
    }
    if (stack.typeId === "minecraft:enchanted_book" && info.enchants?.length === 1) info.name = enchantedBookName(info.enchants[0]);
    try {
        const p = stack.getComponent("minecraft:potion");
        if (p) {
            info.potion = { effect: p.potionEffectType.id };
            info.name = potionName(stack.typeId, p.potionEffectType.id);
        }
    } catch {
        // not a potion
    }
    return info;
}

export function heldStack(player: Player): ItemStack | undefined {
    return player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
}

/** Non-empty hotbar stacks (slots 0-8). */
export function hotbarStacks(player: Player): ItemStack[] {
    const c = player.getComponent("minecraft:inventory")?.container;
    const out: ItemStack[] = [];
    if (!c) return out;
    for (let i = 0; i < 9; i++) {
        const it = c.getItem(i);
        if (it) out.push(it);
    }
    return out;
}
