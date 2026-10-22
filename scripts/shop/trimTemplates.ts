import { ItemStack, world, type Dimension, type Entity, type Player } from "@minecraft/server";
import { getShop, getTrimStorage, newId, saveShop, setTrimStorage } from "./shopStore";

/**
 * The Script API (checked in @minecraft/server 2.11.0-beta typings) has no way to read or set an
 * armor trim or firework explosion data on an ItemStack. A real ItemStack does keep its trim when it is moved between
 * containers though (the same thing /bus:inventory relies on), so trims are "captured": an admin
 * holds trimmed armor, BUS moves a copy into a hidden storage entity, and shop items refer to that
 * slot. A ticking area keeps the entity's chunk loaded so it can be read at any time.
 */
const STORAGE_ENTITY_ID = "bus:inventory_storage";
const AREA_NAME = "bus_shop_captured_items";
export const MAX_TRIM_TEMPLATES = 40;

function storageEntity(): Entity | undefined {
    const s = getTrimStorage();
    if (!s) return undefined;
    try {
        const e = world.getEntity(s.entityId);
        if (e?.isValid) return e;
    } catch {
        // not loaded
    }
    try {
        const dim = world.getDimension(s.dimensionId);
        return dim.getEntities({ type: STORAGE_ENTITY_ID, location: { x: s.x, y: s.y, z: s.z }, maxDistance: 4 })[0];
    } catch {
        return undefined;
    }
}

function createStorage(player: Player): Entity | undefined {
    const dim: Dimension = player.dimension;
    const x = Math.floor(player.location.x);
    const z = Math.floor(player.location.z);
    const y = dim.heightRange.max - 5;
    try {
        dim.runCommand(`tickingarea add ${x} ${y} ${z} ${x} ${y} ${z} ${AREA_NAME} true`);
    } catch {
        // already exists or limit reached; the entity still gets created
    }
    const e = dim.spawnEntity(STORAGE_ENTITY_ID as never, { x: x + 0.5, y, z: z + 0.5 });
    e.addEffect("invisibility", 20000000, { showParticles: false });
    setTrimStorage({ dimensionId: dim.id, x: x + 0.5, y, z: z + 0.5, entityId: e.id });
    return e;
}

export type CaptureResult = "ok" | "no_item" | "full" | "failed";

/** Items whose data the Script API cannot rebuild, so they are captured automatically on import. */
const AUTO_CAPTURE = new Set(["minecraft:firework_rocket", "minecraft:firework_star"]);
export const needsCapture = (typeId: string): boolean => AUTO_CAPTURE.has(typeId);

function uniqueName(base: string): string {
    const names = new Set(getShop().trims.map((x) => x.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
}

/**
 * Stores a copy of `stack` as a template (armor with a trim, fireworks, anything the API can't build).
 * Must run outside restricted execution (wrap in system.run).
 */
export function captureStack(player: Player, stack: ItemStack, name: string): { res: CaptureResult; id?: string } {
    const cfg = getShop();
    if (cfg.trims.length >= MAX_TRIM_TEMPLATES) return { res: "full" };
    try {
        const entity = storageEntity() ?? createStorage(player);
        const container = entity?.getComponent("minecraft:inventory")?.container;
        if (!container) return { res: "failed" };
        const used = new Set(cfg.trims.map((x) => x.slot));
        let slot = 0;
        while (used.has(slot)) slot++;
        if (slot >= container.size) return { res: "full" };
        const copy = stack.clone();
        copy.amount = 1;
        container.setItem(slot, copy);
        const id = newId("t");
        cfg.trims.push({ id, name: uniqueName(name.trim().slice(0, 60) || stack.typeId.replace("minecraft:", "")), slot });
        saveShop();
        return { res: "ok", id };
    } catch (e) {
        console.warn(`[bus:shop] capture failed: ${e}`);
        return { res: "failed" };
    }
}

/** Captures the held item as a template. */
export function captureHeld(player: Player, name: string): { res: CaptureResult; id?: string } {
    const held = player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
    if (!held) return { res: "no_item" };
    return captureStack(player, held, name);
}

/** For fireworks and similar: captures the stack and returns the template id (undefined for other items). */
export function autoCapture(player: Player, stack: ItemStack): string | undefined {
    return needsCapture(stack.typeId) ? captureStack(player, stack, "").id : undefined;
}

export function deleteTrimTemplate(id: string): void {
    const cfg = getShop();
    const tpl = cfg.trims.find((x) => x.id === id);
    if (!tpl) return;
    try {
        storageEntity()?.getComponent("minecraft:inventory")?.container?.setItem(tpl.slot);
    } catch {
        // ignore
    }
    cfg.trims = cfg.trims.filter((x) => x.id !== id);
    saveShop();
}

/** A fresh copy of the captured armor (with its trim), or undefined if it can't be read. */
export function getTrimTemplateStack(id: string): ItemStack | undefined {
    const tpl = getShop().trims.find((x) => x.id === id);
    if (!tpl) return undefined;
    try {
        return storageEntity()?.getComponent("minecraft:inventory")?.container?.getItem(tpl.slot)?.clone();
    } catch {
        return undefined;
    }
}

export function trimTemplateTypeId(id: string): string | undefined {
    return getTrimTemplateStack(id)?.typeId;
}

