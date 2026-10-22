export interface ShopPotion {
    effect: string;
}

export interface ShopEnchant {
    /** Enchantment id without namespace, e.g. "sharpness". */
    id: string;
    level: number;
}

/** Something that can be turned into an ItemStack. */
export interface ItemSpec {
    itemId: string;
    /** Applied as enchantments (or stored enchantments for minecraft:enchanted_book). */
    enchants?: ShopEnchant[];
    /** id of a captured trim template (see trimTemplates.ts). Armor only. */
    trimId?: string;
    /** Potion effect (id from Potions). The delivery (drink/splash/lingering) comes from itemId. Only used on potion items. */
    potion?: ShopPotion;
    /** Only present in share codes / during import: re-links to a trim template by name. */
    trimName?: string;
    nameTag?: string;
}

export interface ShopItem extends ItemSpec {
    id: string;
    name: string;
    /** Price for one bundle of `unitAmount` items. undefined = the category default price. */
    price?: number;
    /** Items per bundle (default 1): 2 here with price 1 means "2 for 1". */
    unitAmount?: number;
    icon?: string;
    lore?: string;
    minQuantity?: number;
    maxQuantity?: number;
    step?: number;
}

export interface KitContent extends ItemSpec {
    amount: number;
}

export interface ShopKit {
    id: string;
    name: string;
    price: number;
    icon?: string;
    lore?: string;
    contents: KitContent[];
    allowQuantity?: boolean;
    maxQuantity?: number;
}

export interface Sellable {
    id: string;
    itemId: string;
    name: string;
    /** Paid per bundle of `unitAmount` items. undefined = the category default price. */
    sellPrice?: number;
    unitAmount?: number;
    icon?: string;
    maxSellPerTransaction?: number;
}

export interface ShopCategory {
    id: string;
    name: string;
    icon?: string;
    /** Used by items/sell items in this category (and its sub-categories) that have no price of their own. */
    defaultPrice?: number;
    children: ShopCategory[];
    items: ShopItem[];
    kits: ShopKit[];
    sellables: Sellable[];
}

export interface TrimTemplate {
    id: string;
    name: string;
    /** Slot inside the storage entity's container. */
    slot: number;
}

export interface TrimStorage {
    dimensionId: string;
    x: number;
    y: number;
    z: number;
    entityId: string;
}

export interface ShopConfig {
    currencyName: string;
    /** true = shop browsing screens use the newer (DDUI) style: more modern, but no item icons. */
    modernUI: boolean;
    /** Scoreboard objective that holds balances. */
    objectiveName: string;
    /** true = /bus:shop asks Buy or Sell first; false = opens the buy shop. */
    openMenu: boolean;
    buyRoot: ShopCategory;
    sellRoot: ShopCategory;
    trims: TrimTemplate[];
}

export type ShopTree = "buy" | "sell";
