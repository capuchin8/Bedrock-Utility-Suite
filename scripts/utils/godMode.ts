import {
  EntityDamageCause,
  HudElement,
  HudVisibility,
  Player,
  system,
  world,
  type Entity,
  type EntityDamageSource,
  type EntityHurtAfterEvent,
  type ItemCompleteUseAfterEvent,
  type PlayerSpawnAfterEvent,
  type Vector3,
} from "@minecraft/server";
import { readWorldJson, writeWorldJson } from "../core/storage";

// Reusable god mode service. Works on players AND other entities (pets, mobs, ...).
//   import { isGod, setGod, toggleGod, onGodChanged } from "../utils/godMode";
// setGod/toggleGod mutate the entity, so call them outside restricted execution (wrap in system.run).
//
// The event handlers only exist while at least one entity is in god mode. The ids of everything in
// god mode are kept in the world property "bus:god_ids"; the per-entity flag below stays the source of truth.

const KEY = "bus:god"; // entity dynamic property: true while god mode is on (survives rejoin/reload)
const HOME_KEY = "bus:god_home"; // non-players only: where to put them back after a void fall
const IDS_KEY = "bus:god_ids"; // world property: JSON array of entity ids currently in god mode

const EFFECTS: { id: string; amplifier: number }[] = [
  { id: "resistance", amplifier: 255 },
  { id: "fire_resistance", amplifier: 255 },
  { id: "water_breathing", amplifier: 255 },
  { id: "saturation", amplifier: 255 }, // keeps player hunger from dropping
];

// Players can still be hurt by these so they can be rescued from the void.
// Non-players are protected from everything.
const PLAYER_ALLOWED_CAUSES = new Set<string>([EntityDamageCause.void]);

export type GodListener = (entity: Entity, enabled: boolean) => void;
const listeners: GodListener[] = [];

/** Runs after god mode is switched on or off for an entity (players included). */
export function onGodChanged(listener: GodListener): void {
  listeners.push(listener);
}

export function isGod(entity: Entity): boolean {
  try {
    return entity.getDynamicProperty(KEY) === true;
  } catch {
    return false;
  }
}

// ---- effects ------------------------------------------------------------------------------------

function applyEffects(entity: Entity): void {
  if (!entity.isValid) return;
  for (const e of EFFECTS) {
    try {
      // "infinite" only needs to be applied once; hideParticles = true.
      const result = entity.runCommand(`effect @s ${e.id} infinite ${e.amplifier} true`);
      if (result.successCount === 0) console.warn(`[bus:god] /effect ${e.id} did not apply`);
    } catch (err) {
      console.warn(`[bus:god] could not add ${e.id}: ${err}`);
    }
  }
  // Hide the effect icons so god mode isn't visible on the player's screen.
  if (entity instanceof Player) {
    try {
      entity.onScreenDisplay.setHudVisibility(HudVisibility.Hide, [HudElement.StatusEffects]);
    } catch (err) {
      console.warn(`[bus:god] could not hide the effects HUD: ${err}`);
    }
  }
}

function clearEffects(entity: Entity): void {
  if (!entity.isValid) return;
  for (const e of EFFECTS) {
    try {
      entity.removeEffect(e.id);
    } catch {
      // not present
    }
  }
  if (entity instanceof Player) {
    try {
      entity.onScreenDisplay.setHudVisibility(HudVisibility.Reset, [HudElement.StatusEffects]);
    } catch {
      // player left
    }
  }
}

// ---- void rescue (non-players) ------------------------------------------------------------------

interface Home {
  dimensionId: string;
  x: number;
  y: number;
  z: number;
}

function saveHome(entity: Entity): void {
  const home: Home = {
    dimensionId: entity.dimension.id,
    x: entity.location.x,
    y: entity.location.y,
    z: entity.location.z,
  };
  entity.setDynamicProperty(HOME_KEY, JSON.stringify(home));
}

function readHome(entity: Entity): Home | undefined {
  const raw = entity.getDynamicProperty(HOME_KEY);
  if (typeof raw !== "string") return undefined;
  try {
    const v = JSON.parse(raw) as Home;
    return typeof v.dimensionId === "string" && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
      ? v
      : undefined;
  } catch {
    return undefined;
  }
}

/** Puts a protected non-player back at its saved spot after it fell out of the world. */
function rescueFromVoid(entity: Entity): void {
  system.run(() => {
    if (!entity.isValid) return;
    const home = readHome(entity);
    try {
      if (entity.location.y >= entity.dimension.heightRange.min) return; // already rescued this tick
      if (home) {
        const target: Vector3 = { x: home.x, y: home.y, z: home.z };
        entity.teleport(target, { dimension: world.getDimension(home.dimensionId) });
      } else {
        entity.teleport(world.getDefaultSpawnLocation(), { dimension: world.getDimension("overworld") });
      }
    } catch (e) {
      console.warn(`[bus:god] void rescue failed: ${e}`);
    }
  });
}

// ---- event handlers (only subscribed while somebody is in god mode) -----------------------------

// Effects and HUD settings don't survive a player's death or rejoin, so reapply on every spawn.
const onSpawn = ({ player }: PlayerSpawnAfterEvent): void => {
  if (isGod(player)) applyEffects(player);
};

// Milk clears all effects.
const onItemComplete = ({ source, itemStack }: ItemCompleteUseAfterEvent): void => {
  if (itemStack?.typeId !== "minecraft:milk_bucket") return;
  if (source instanceof Player && isGod(source)) system.run(() => applyEffects(source));
};

// world.beforeEvents.entityHurt is unverified in 2.11.0-beta, so it's reached through a local type.
interface HurtBeforeEvent {
  hurtEntity: Entity;
  damageSource: EntityDamageSource;
  cancel: boolean;
}
interface HurtBeforeSignal {
  subscribe(callback: (event: HurtBeforeEvent) => void): unknown;
  unsubscribe(callback: (event: HurtBeforeEvent) => void): unknown;
}

function getHurtBefore(): HurtBeforeSignal | undefined {
  try {
    return (world.beforeEvents as unknown as { entityHurt?: HurtBeforeSignal }).entityHurt;
  } catch {
    return undefined;
  }
}

// Before-event: read and set cancel only (the rescue is deferred inside rescueFromVoid).
const onHurtBefore = (event: HurtBeforeEvent): void => {
  const entity = event.hurtEntity;
  if (!isGod(entity)) return;
  if (entity instanceof Player) {
    if (PLAYER_ALLOWED_CAUSES.has(event.damageSource.cause)) return;
    event.cancel = true;
    return;
  }
  // Non-players: nothing gets through, including /kill and the void.
  event.cancel = true;
  if (event.damageSource.cause === EntityDamageCause.void) rescueFromVoid(entity);
};

// Backstop for players if anything still got through.
const onHurtAfter = ({ hurtEntity, damageSource }: EntityHurtAfterEvent): void => {
  if (!(hurtEntity instanceof Player) || !isGod(hurtEntity)) return;
  if (PLAYER_ALLOWED_CAUSES.has(damageSource.cause)) return;
  try {
    hurtEntity.getComponent("minecraft:health")?.resetToMaxValue();
  } catch {
    // died or became invalid
  }
};

let active = false;

function activate(): void {
  if (active) return;
  active = true;
  try {
    world.afterEvents.playerSpawn.subscribe(onSpawn);
    world.afterEvents.itemCompleteUse.subscribe(onItemComplete);
    world.afterEvents.entityHurt.subscribe(onHurtAfter);
    const hurtBefore = getHurtBefore();
    if (hurtBefore) hurtBefore.subscribe(onHurtBefore);
    else console.warn("[bus:god] world.beforeEvents.entityHurt is unavailable; non-players can't be fully protected.");
  } catch (e) {
    console.warn(`[bus:god] could not subscribe god mode events: ${e}`);
  }
}

function deactivate(): void {
  if (!active) return;
  active = false;
  try {
    world.afterEvents.playerSpawn.unsubscribe(onSpawn);
    world.afterEvents.itemCompleteUse.unsubscribe(onItemComplete);
    world.afterEvents.entityHurt.unsubscribe(onHurtAfter);
    getHurtBefore()?.unsubscribe(onHurtBefore);
  } catch (e) {
    console.warn(`[bus:god] could not unsubscribe god mode events: ${e}`);
  }
}

// ---- tracking who is in god mode (world property) -----------------------------------------------

let godIds = new Set<string>();

function loadIds(): void {
  const raw = readWorldJson<unknown>(IDS_KEY, []);
  godIds = new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
}

function saveIds(): void {
  if (godIds.size === 0) world.setDynamicProperty(IDS_KEY, undefined);
  else writeWorldJson(IDS_KEY, [...godIds]);
}

function track(id: string, enabled: boolean): void {
  if (enabled === godIds.has(id)) return;
  if (enabled) godIds.add(id);
  else godIds.delete(id);
  saveIds();
  if (godIds.size > 0) activate();
  else deactivate();
}

// World properties may not be readable in early execution, so the saved list is read once the world is loaded.
// If it has entries, the handlers go live before players spawn. (worldLoad is unverified in 2.11.0-beta.)
world.afterEvents.worldLoad.subscribe(() => {
  loadIds();
  if (godIds.size > 0) activate();
});

// ---- public API ---------------------------------------------------------------------------------

/** Sets god mode explicitly. Returns the new state. */
export function setGod(entity: Entity, enabled: boolean): boolean {
  if (!entity.isValid) return false;
  entity.setDynamicProperty(KEY, enabled ? true : undefined);
  if (enabled) {
    // Remember where a non-player was when protected, so a void fall can put it back.
    if (!(entity instanceof Player)) saveHome(entity);
    applyEffects(entity);
  } else {
    entity.setDynamicProperty(HOME_KEY, undefined);
    clearEffects(entity);
  }
  track(entity.id, enabled);
  for (const listener of listeners) {
    try {
      listener(entity, enabled);
    } catch (e) {
      console.warn(`[bus:god] listener failed: ${e}`);
    }
  }
  return enabled;
}

/** Flips god mode. Returns the new state. */
export function toggleGod(entity: Entity): boolean {
  return setGod(entity, !isGod(entity));
}
