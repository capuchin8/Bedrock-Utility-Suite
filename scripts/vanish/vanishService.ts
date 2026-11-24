import {
  EntityComponentTypes,
  EquipmentSlot,
  GameMode,
  HudElement,
  HudVisibility,
  ItemLockMode,
  ItemStack,
  ItemTypes,
  Player,
  system,
  world,
  type Dimension,
  type Entity,
  type EntityHitEntityAfterEvent,
  type EntityHurtAfterEvent,
  type ItemCompleteUseAfterEvent,
  type PlayerSpawnAfterEvent,
  type Vector3,
} from "@minecraft/server";
import { t, tell } from "../core/lang";
import { onPlayerJoin } from "../events/playerEvents";
import { expandText, getDisplayName } from "../roles/display";
import { isGod } from "../utils/godMode";
import {
  PREV_MODE_PROP,
  VANISHED_PROP,
  getVanishSettings,
  getVanishedIds,
  isVanished,
  loadVanishIds,
  notifyVanishChanged,
  onVanishSettingsChanged,
  setTracked,
} from "./vanishStore";

// Vanish service. setVanish(player, on) is the one entry point (commands, other modules).
// Call it outside restricted execution (wrap in system.run in before-events / command callbacks).
//
// Hiding = infinite invisibility (no particles) + status effect HUD hidden. Armor and held items are
// hidden client-side by the optional player.entity.json scale expression (see SETUP.md).
// The event handlers only exist while at least one player is vanished.

const LOCATOR_PREV = "bus:vanish_locator_prev"; // world property: true while WE turned the locator bar off
const MARKER_PARTICLE = "bus:vanish_marker";
const MARKER_RANGE = 48;
const TICK_INTERVAL = 5; // loop beat in ticks: reminder every 6th beat, particles every 2nd, animation every ANIMATION_REFRESH_TICKS

// Client-side animation (RP animations/bus_vanish.animation.json) that shrinks the model, armor and held
// items. /playanimation only reaches clients that are tracking the player at that moment, so it is replayed
// while someone is vanished for players who come into range later. The stop expression ends it by itself once
// the invisibility effect is gone, but a client that hasn't received the invisible flag yet cancels it at
// once, so it is also replayed a little after vanishing.
const HIDE_ANIMATION = "animation.bus_vanish";
/** Ticks between replays (20 = 1 second). Raise it for less often, lower it for faster recovery. Must be a multiple of TICK_INTERVAL. */
const ANIMATION_REFRESH_TICKS = 20;
/** Extra plays after vanishing, in ticks: covers clients that hadn't received the invisibility yet. */
const FIRST_REPLAY_TICKS = [2, 10];

function playHideAnimation(player: Player): void {
  if (!player.isValid) return;
  try {
    player.runCommand(`playanimation @s ${HIDE_ANIMATION} none 0.5 "!query.is_invisible"`);
  } catch {
    // player left
  }
}

// ---- map head ----------------------------------------------------------------------------------
// Optional: a locked head item (setting) so the player's marker doesn't show on maps. A worn helmet is moved
// to the first free inventory slot (never deleted; if there is none, nothing is changed) and its slot is
// remembered in a player property. On reveal the marker is removed and the helmet is put back on the head
// (looked up in its slot, else by item type if the player moved it). Whether the chosen item actually hides
// the map marker is unverified.
const HEAD_LORE = "bus:vanish_head";
const HELMET_PROP = "bus:vanish_helmet"; // JSON { slot, typeId }

const headSlot = (player: Player) =>
  player.getComponent(EntityComponentTypes.Equippable)?.getEquipmentSlot(EquipmentSlot.Head);

const isMarkerHead = (item: ItemStack | undefined): boolean => !!item && item.getLore().includes(HEAD_LORE);

function equipMapHead(player: Player): void {
  const s = getVanishSettings();
  if (!s.hideFromMaps) return;
  try {
    const slot = headSlot(player);
    if (!slot) return;
    const current = slot.getItem();
    if (isMarkerHead(current)) return;
    // No marker on the head: anything remembered from an earlier vanish is stale (death, relog).
    player.setDynamicProperty(HELMET_PROP, undefined);
    if (!ItemTypes.get(s.mapHeadItem)) {
      console.warn(`[bus:vanish] unknown map head item: ${s.mapHeadItem}`);
      return;
    }
    if (current) {
      const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
      const free = inventory?.firstEmptySlot();
      if (!inventory || free === undefined) {
        tell(player, t("bus.vanish.head_no_room"));
        return;
      }
      inventory.setItem(free, current);
      player.setDynamicProperty(HELMET_PROP, JSON.stringify({ slot: free, typeId: current.typeId }));
    }
    const head = new ItemStack(s.mapHeadItem, 1);
    head.lockMode = ItemLockMode.slot;
    head.keepOnDeath = false;
    head.setLore([HEAD_LORE]);
    slot.setItem(head);
  } catch (e) {
    console.warn(`[bus:vanish] could not equip the map head: ${e}`);
  }
}

function restoreHelmet(player: Player, slot: { setItem(item?: ItemStack): void }): void {
  const raw = player.getDynamicProperty(HELMET_PROP);
  player.setDynamicProperty(HELMET_PROP, undefined);
  if (typeof raw !== "string") return;
  let saved: { slot?: unknown; typeId?: unknown };
  try {
    saved = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof saved.slot !== "number" || typeof saved.typeId !== "string") return;
  const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!inventory) return;

  let from = saved.slot < inventory.size && inventory.getItem(saved.slot)?.typeId === saved.typeId ? saved.slot : -1;
  for (let i = 0; from < 0 && i < inventory.size; i++) {
    if (inventory.getItem(i)?.typeId === saved.typeId) from = i; // the player moved it
  }
  const item = from >= 0 ? inventory.getItem(from) : undefined;
  if (!item) return;
  inventory.setItem(from, undefined);
  slot.setItem(item);
}

function removeMapHead(player: Player): void {
  try {
    const slot = headSlot(player);
    if (!slot) return;
    if (!isMarkerHead(slot.getItem())) {
      player.setDynamicProperty(HELMET_PROP, undefined); // marker gone (death): nothing to give back
      return;
    }
    slot.setItem(undefined);
    restoreHelmet(player, slot);
  } catch {
    // player left
  }
}

// ---- punch sound -------------------------------------------------------------------------------
// A hit involving a vanished player would still be heard, whether the vanished player is the attacker or the
// one being hit. Cancelling damage doesn't stop the sound (tested), so the attack and hurt sounds are
// stopped for nearby players with /stopsound. This uses AFTER events, where commands can run in the same tick
// as the hit (a before-event can only defer to the next tick, by which time the sound has already started):
//  - entityHitEntity fires for every melee hit, even when no damage is dealt (a God mode victim never fires
//    entityHurt), so it covers the attack sounds;
//  - entityHurt covers the hurt sound, including non-melee damage.
// The stop is repeated on the next ticks in case the sound only starts then. Ids are the vanilla ones from
// bedrock-samples (sound_definitions.json, 1.26.60); there is no "attack.weak".
const PUNCH_SOUNDS = [
  "game.player.attack.strong",
  "game.player.attack.critical",
  "game.player.attack.nodamage",
  "game.player.hurt",
];
const PUNCH_SOUND_RADIUS = 32;
const PUNCH_REPEAT_TICKS = [1, 2, 4];

function silencePunch(dimension: Dimension, at: Vector3): void {
  for (const sound of PUNCH_SOUNDS) {
    try {
      dimension.runCommand(`stopsound @a[x=${at.x},y=${at.y},z=${at.z},r=${PUNCH_SOUND_RADIUS}] ${sound}`);
    } catch {
      // nobody in range
    }
  }
}

const isVanishedPlayer = (entity: Entity | undefined): boolean => entity instanceof Player && isVanished(entity);

// A melee hit that also deals damage fires both events: only handle each victim once per tick.
let lastSilencedTick = -1;
const silencedThisTick = new Set<string>();

function silenceAround(victim: Entity): void {
  const tick = system.currentTick;
  if (tick !== lastSilencedTick) {
    lastSilencedTick = tick;
    silencedThisTick.clear();
  }
  if (silencedThisTick.has(victim.id)) return;
  silencedThisTick.add(victim.id);

  const dimension = victim.dimension;
  const at = victim.location;
  silencePunch(dimension, at);
  for (const delay of PUNCH_REPEAT_TICKS) system.runTimeout(() => silencePunch(dimension, at), delay);
}

const onHit = ({ damagingEntity, hitEntity }: EntityHitEntityAfterEvent): void => {
  if (isVanishedPlayer(damagingEntity) || isVanishedPlayer(hitEntity)) silenceAround(hitEntity);
};

const onHurt = ({ hurtEntity, damageSource }: EntityHurtAfterEvent): void => {
  if (isVanishedPlayer(damageSource.damagingEntity) || isVanishedPlayer(hurtEntity)) silenceAround(hurtEntity);
};

// ---- fake messages -----------------------------------------------------------------------------

/** {name} / {realname} filled in after & codes and \uXXXX glyphs are expanded. */
export function formatFake(format: string, name: string, realName: string): string {
  return expandText(format).replace(/\{(name|realname)\}/gi, (_m, token: string) =>
    token.toLowerCase() === "name" ? name : realName
  );
}

function announce(player: Player, kind: "join" | "leave"): void {
  const s = getVanishSettings();
  if (!s.fakeMessages) return;
  const format = kind === "join" ? s.joinFormat : s.leaveFormat;
  if (!format.trim()) return;
  world.sendMessage(formatFake(format, getDisplayName(player, "chat"), player.name));
}

// ---- hiding ------------------------------------------------------------------------------------

function hide(player: Player): void {
  if (!player.isValid) return;
  try {
    player.addEffect("invisibility", 20000000, { amplifier: 0, showParticles: false });
  } catch (e) {
    console.warn(`[bus:vanish] could not add invisibility: ${e}`);
  }
  try {
    player.onScreenDisplay.setHudVisibility(HudVisibility.Hide, [HudElement.StatusEffects]);
  } catch (e) {
    console.warn(`[bus:vanish] could not hide the effects HUD: ${e}`);
  }
  equipMapHead(player);
  playHideAnimation(player);
  for (const delay of FIRST_REPLAY_TICKS) system.runTimeout(() => playHideAnimation(player), delay);
}

function reveal(player: Player): void {
  if (!player.isValid) return;
  try {
    player.removeEffect("invisibility");
  } catch {
    // not present
  }
  removeMapHead(player);
  // God mode also hides the effect icons: leave them hidden for it.
  if (!isGod(player)) {
    try {
      player.onScreenDisplay.setHudVisibility(HudVisibility.Reset, [HudElement.StatusEffects]);
    } catch {
      // player left
    }
  }
}

function restoreMode(player: Player): void {
  const prev = player.getDynamicProperty(PREV_MODE_PROP);
  if (typeof prev !== "string") return;
  player.setDynamicProperty(PREV_MODE_PROP, undefined);
  if (!(Object.values(GameMode) as string[]).includes(prev)) return;
  try {
    player.setGameMode(prev as GameMode);
  } catch (e) {
    console.warn(`[bus:vanish] could not restore the game mode: ${e}`);
  }
}

// ---- locator bar -------------------------------------------------------------------------------
// The locator bar is the game rule `playerwaypoints` (values: off / everyone). Its current value can't be
// read from scripts or with a blank command, so BUS assumes it is ON ("everyone") when it turns it off and
// puts it back to "everyone" afterwards. If it was already off, the setting would turn it on at the end.
// That is why the setting is off by default. `locatorbar true|false` is tried as a fallback for older builds.
const LOCATOR_ON = "everyone";
const LOCATOR_OFF = "off";

interface CommandResultLike {
  successCount?: number;
}

function runRule(command: string): boolean {
  try {
    const result = world.getDimension("overworld").runCommand(command) as CommandResultLike | undefined;
    return result?.successCount === undefined || result.successCount > 0;
  } catch {
    return false;
  }
}

function writeLocator(on: boolean): void {
  if (runRule(`gamerule playerwaypoints ${on ? LOCATOR_ON : LOCATOR_OFF}`)) return;
  if (runRule(`gamerule locatorbar ${on}`)) return;
  console.warn("[bus:vanish] could not change the locator bar (gamerule playerwaypoints / locatorbar).");
}

/**
 * Off while someone is vanished and exactly one non-vanished player is online (that player could
 * otherwise tell who is still around); back on afterwards.
 */
export function updateLocatorBar(): void {
  const online = world.getAllPlayers();
  const vanished = online.filter(isVanished).length;
  const shouldBeOff = getVanishSettings().adjustLocatorBar && vanished > 0 && online.length - vanished === 1;
  const weTurnedItOff = world.getDynamicProperty(LOCATOR_PREV) === true;

  if (shouldBeOff && !weTurnedItOff) {
    world.setDynamicProperty(LOCATOR_PREV, true);
    writeLocator(false);
  } else if (!shouldBeOff && weTurnedItOff) {
    world.setDynamicProperty(LOCATOR_PREV, undefined);
    writeLocator(true);
  }
}

// ---- reminder + marker particles (one interval, only while someone is vanished) -----------------

let loop: number | undefined;
let beat = 0;

function tick(): void {
  const vanished = world.getAllPlayers().filter(isVanished);
  if (vanished.length === 0) {
    stopLoop();
    return;
  }
  const s = getVanishSettings();
  beat++;
  if (beat % Math.max(1, Math.round(ANIMATION_REFRESH_TICKS / TICK_INTERVAL)) === 0) {
    for (const p of vanished) playHideAnimation(p);
  }
  if (s.reminder && beat % 6 === 0) {
    for (const p of vanished) {
      try {
        p.onScreenDisplay.setActionBar(t("bus.vanish.reminder"));
      } catch {
        // player left
      }
    }
  }
  if (!s.particles || vanished.length < 2 || beat % 2 !== 0) return;
  for (const viewer of vanished) {
    for (const other of vanished) {
      if (other.id === viewer.id || other.dimension.id !== viewer.dimension.id) continue;
      const a = viewer.location;
      const b = other.location;
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > MARKER_RANGE) continue;
      try {
        viewer.spawnParticle(MARKER_PARTICLE, { x: b.x, y: b.y + 1, z: b.z });
      } catch {
        // chunk not loaded for this position
      }
    }
  }
}

function ensureLoop(): void {
  if (loop === undefined) loop = system.runInterval(tick, TICK_INTERVAL);
}

function stopLoop(): void {
  if (loop !== undefined) system.clearRun(loop);
  loop = undefined;
}

// ---- event handlers (subscribed only while somebody is vanished) -------------------------------

// Effects and HUD settings don't survive death or rejoin: reapply on every spawn.
const onSpawn = ({ player }: PlayerSpawnAfterEvent): void => {
  if (isVanished(player)) hide(player);
  updateLocatorBar();
  ensureLoop();
};

const onLeave = (): void => updateLocatorBar();

// Milk clears all effects.
const onItemComplete = ({ source, itemStack }: ItemCompleteUseAfterEvent): void => {
  if (itemStack?.typeId !== "minecraft:milk_bucket") return;
  if (source instanceof Player && isVanished(source)) system.run(() => hide(source));
};

let active = false;

function activate(): void {
  if (active) return;
  active = true;
  world.afterEvents.playerSpawn.subscribe(onSpawn);
  world.afterEvents.playerLeave.subscribe(onLeave);
  world.afterEvents.itemCompleteUse.subscribe(onItemComplete);
  world.afterEvents.entityHitEntity.subscribe(onHit);
  world.afterEvents.entityHurt.subscribe(onHurt);
}

function deactivate(): void {
  if (!active) return;
  active = false;
  world.afterEvents.playerSpawn.unsubscribe(onSpawn);
  world.afterEvents.playerLeave.unsubscribe(onLeave);
  world.afterEvents.itemCompleteUse.unsubscribe(onItemComplete);
  world.afterEvents.entityHitEntity.unsubscribe(onHit);
  world.afterEvents.entityHurt.unsubscribe(onHurt);
}

function track(playerId: string, on: boolean): void {
  setTracked(playerId, on);
  if (getVanishedIds().size > 0) activate();
  else deactivate();
}

// ---- public API --------------------------------------------------------------------------------

/** Vanishes or reveals a player. Returns false if nothing changed. */
export function setVanish(player: Player, on: boolean): boolean {
  if (!player.isValid || isVanished(player) === on) return false;
  const s = getVanishSettings();

  if (on) {
    player.setDynamicProperty(VANISHED_PROP, true);
    track(player.id, true);
    hide(player);
    if (s.spectator) {
      try {
        const mode = player.getGameMode();
        if (mode !== GameMode.Spectator) {
          player.setDynamicProperty(PREV_MODE_PROP, mode);
          player.setGameMode(GameMode.Spectator);
        }
      } catch (e) {
        console.warn(`[bus:vanish] could not switch to spectator: ${e}`);
      }
    }
    ensureLoop();
    announce(player, "leave");
  } else {
    player.setDynamicProperty(VANISHED_PROP, undefined);
    track(player.id, false);
    reveal(player);
    restoreMode(player);
    announce(player, "join");
  }

  updateLocatorBar();
  notifyVanishChanged(player, on);
  return true;
}

// A player who rejoins while marked vanished: keep them hidden (persist on) or clean up (persist off).
// Their old invisibility effect can still be on them, so it is always handled here. No fake message:
// the vanilla join message can't be cancelled by scripts.
onPlayerJoin((player) => {
  if (player.getDynamicProperty(VANISHED_PROP) !== true) return;
  system.run(() => {
    if (!player.isValid) return;
    if (getVanishSettings().persist) {
      track(player.id, true);
      hide(player);
      ensureLoop();
    } else {
      player.setDynamicProperty(VANISHED_PROP, undefined);
      track(player.id, false);
      reveal(player);
      restoreMode(player);
    }
    updateLocatorBar();
    notifyVanishChanged(player, isVanished(player));
  });
});

// World properties are readable once the world has loaded: read the saved list, go live if needed,
// and give back a locator bar that was left off by a previous session.
world.afterEvents.worldLoad.subscribe(() => {
  loadVanishIds();
  if (getVanishedIds().size > 0) activate();
  ensureLoop();
  updateLocatorBar();
  notifyVanishChanged();
});

onVanishSettingsChanged(() => {
  updateLocatorBar();
  const vanished = world.getAllPlayers().filter(isVanished);
  if (vanished.length > 0) ensureLoop();
  // The map head setting can change while players are vanished.
  const wantHead = getVanishSettings().hideFromMaps;
  for (const p of vanished) {
    removeMapHead(p);
    if (wantHead) equipMapHead(p);
  }
});
