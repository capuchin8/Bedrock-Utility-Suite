import { world } from "@minecraft/server";

const KEY_PREFIX = "bus:iconOverride:";

/**
 * Dynamic property keys are capped at 100 characters — long modded typeIds
 * could theoretically bump into this. Truncation would corrupt the key, so
 * we just refuse to store anything that doesn't fit rather than guess.
 */
const MAX_KEY_LENGTH = 100;

function keyFor(typeId: string): string {
    return `${KEY_PREFIX}${typeId}`;
}

/** Returns the admin-set icon path for this item, or undefined if none is set. */
export function getIconOverride(typeId: string): string | undefined {
    const value = world.getDynamicProperty(keyFor(typeId));
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Saves an admin-provided texture path as this item's icon override.
 * Returns false (and saves nothing) if the typeId is too long to key safely.
 */
export function setIconOverride(typeId: string, texturePath: string): boolean {
    const key = keyFor(typeId);
    if (key.length > MAX_KEY_LENGTH) return false;

    world.setDynamicProperty(key, texturePath.trim());
    return true;
}

export function clearIconOverride(typeId: string): void {
    world.setDynamicProperty(keyFor(typeId), undefined);
}
