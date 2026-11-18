import { world } from "@minecraft/server";
import { t } from "../../core/lang";
import { isRecord } from "../../core/storage";
import { registerShareable } from "../../share/shareRegistry";

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

/** Every admin-set override as { typeId, path }, sorted by item id. */
export function listIconOverrides(): { typeId: string; path: string }[] {
  const out: { typeId: string; path: string }[] = [];
  for (const id of world.getDynamicPropertyIds()) {
    if (!id.startsWith(KEY_PREFIX)) continue;
    const value = world.getDynamicProperty(id);
    if (typeof value === "string" && value) out.push({ typeId: id.slice(KEY_PREFIX.length), path: value });
  }
  return out.sort((a, b) => a.typeId.localeCompare(b.typeId));
}

// ---- share code: the overrides travel with a setup export --------------------------------------

const MAX_OVERRIDES = 1000;

registerShareable({
  id: "bus:item_icons",
  label: t("bus.share.item_icons"),
  export: () => Object.fromEntries(listIconOverrides().map((o) => [o.typeId, o.path])),
  import: (data) => {
    if (!isRecord(data)) return t("bus.share.item_icons.invalid");
    const entries: [string, string][] = [];
    for (const [typeId, path] of Object.entries(data)) {
      if (typeof path !== "string" || !path.trim() || path.length > 200 || keyFor(typeId).length > MAX_KEY_LENGTH) {
        return t("bus.share.item_icons.invalid");
      }
      entries.push([typeId, path.trim()]);
    }
    if (entries.length > MAX_OVERRIDES) return t("bus.share.item_icons.invalid");
    // Validated: replace the current overrides with the imported ones.
    for (const o of listIconOverrides()) clearIconOverride(o.typeId);
    for (const [typeId, path] of entries) setIconOverride(typeId, path);
    return undefined;
  },
});
