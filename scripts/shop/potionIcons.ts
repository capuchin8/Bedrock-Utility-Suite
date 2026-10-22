import { isPotionItem } from "./shopItems";

/**
 * Vanilla potion bottle textures are per effect (potion_bottle_heal, potion_bottle_splash_jump, ...), so a
 * potion's icon depends on its effect, not just its item id. Paths come from vanilla's item_texture.json
 * (Mojang/bedrock-samples); the client already has these textures, no resource pack files are needed.
 */
const EFFECT_SUFFIX: Record<string, string> = {
    healing: "heal",
    harming: "harm",
    leaping: "jump",
    swiftness: "moveSpeed",
    slowness: "moveSlowdown",
    strength: "damageBoost",
    regeneration: "regeneration",
    fire_resistance: "fireResistance",
    water_breathing: "waterBreathing",
    invisibility: "invisibility",
    nightvision: "nightVision",
    night_vision: "nightVision",
    weakness: "weakness",
    poison: "poison",
    wither: "wither",
    turtle_master: "turtleMaster",
    slow_falling: "slowFall",
    wind_charged: "windCharged",
    weaving: "weaving",
    oozing: "oozing",
    infested: "infested",
};

const PREFIX: Record<string, string> = {
    "minecraft:potion": "textures/items/potion_bottle_",
    "minecraft:splash_potion": "textures/items/potion_bottle_splash_",
    "minecraft:lingering_potion": "textures/items/potion_bottle_lingering_",
};

const BASE: Record<string, string> = {
    "minecraft:potion": "textures/items/potion_bottle_drinkable",
    "minecraft:splash_potion": "textures/items/potion_bottle_splash",
    "minecraft:lingering_potion": "textures/items/potion_bottle_lingering",
};

/** Icon for a potion item with the given effect id (long_/strong_ variants use the base effect's icon). Empty if not a potion. */
export function resolvePotionIcon(itemId: string, effectId?: string): string {
    if (!isPotionItem(itemId)) return "";
    if (!effectId) return BASE[itemId];
    const key = effectId.replace(/^[a-z0-9_.-]+:/, "").replace(/^(long|strong)_/, "");
    const suffix = EFFECT_SUFFIX[key];
    return suffix ? PREFIX[itemId] + suffix : BASE[itemId];
}
