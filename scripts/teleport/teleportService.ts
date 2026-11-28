import {
  CustomCommandStatus,
  Player,
  system,
  world,
  type CustomCommandOrigin,
  type CustomCommandResult,
  type Dimension,
  type Vector3,
} from "@minecraft/server";
import type { UIRawMessage } from "@minecraft/server-ui";
import { isInCombat } from "../combat/combatStore";
import { reply } from "../core/commandResult";
import { formatDuration } from "../core/duration";
import { t, tell } from "../core/lang";
import { canUse, registerPermission } from "../permissions/permissionStore";
import { addBalance, getBalance, tryRemoveBalance } from "../shop/shopEconomy";
import { getShop } from "../shop/shopStore";
import { getTeleportSettings, type TeleportKind } from "./teleportSettings";

// The one place that runs a teleport: checks (cooldown, combat, price), the warm-up countdown with
// move/damage cancelling, then the move itself. RTP and TPA both call beginTeleport(); a future feature
// (homes, warps...) only needs a new TeleportKind and one call.
//
// Event-driven: the warm-up loop (every 5 ticks) only exists while somebody is actually waiting, and the
// damage listener is only subscribed the first time a warm-up starts.

export const TELEPORT_BYPASS_KEY = "bus:teleport_bypass";

registerPermission({
  key: TELEPORT_BYPASS_KEY,
  label: t("bus.perm.teleport_bypass.name"),
  description: t("bus.perm.teleport_bypass.desc"),
  category: "feature",
  defaultEveryone: false,
  defaultOperators: true,
});

export interface Destination {
  dimension: Dimension;
  location: Vector3;
}

export interface TeleportRequest {
  kind: TeleportKind;
  /** The player who gets moved (and who must stand still during the warm-up). */
  mover: Player;
  /** Whose cooldown and money count. Defaults to the mover (TPA here: the one who sent the request). */
  payer?: Player;
  /**
   * Works out where to go. Runs when the warm-up ends, so it may be async (RTP loads chunks).
   * Return undefined if there is nowhere to go; the player is not charged.
   */
  resolve: () => Promise<Destination | undefined> | Destination | undefined;
  /** Runs (in a normal context) after the player arrived. */
  onArrived?: (mover: Player) => void;
  /** Runs when the teleport did not happen (cancelled, denied, no destination). */
  onCancelled?: () => void;
}

export type TeleportDenial = "cooldown" | "combat" | "cost" | "busy";

export interface DenialInfo {
  denial: TeleportDenial;
  /** Which player the reason is about (the one to show the detail to). */
  who: Player;
  /** Extra detail with arguments (time left, price), shown on the action bar. */
  detail?: UIRawMessage;
}

const cooldowns = new Map<string, number>();
const warmups = new Map<string, Warmup>();
const resolving = new Set<string>();

interface Warmup {
  req: TeleportRequest;
  start: Vector3;
  dimensionId: string;
  endTick: number;
  lastSecond: number;
}

const cooldownKey = (kind: TeleportKind, player: Player): string => `${kind}:${player.id}`;

export function canBypassTeleportRules(player: Player): boolean {
  return canUse(player, TELEPORT_BYPASS_KEY);
}

/** Milliseconds left on this player's cooldown for this kind (0 = ready). */
export function getCooldownLeftMs(kind: TeleportKind, player: Player): number {
  const end = cooldowns.get(cooldownKey(kind, player));
  if (end === undefined) return 0;
  const left = end - Date.now();
  if (left <= 0) {
    cooldowns.delete(cooldownKey(kind, player));
    return 0;
  }
  return left;
}

export function isTeleporting(player: Player): boolean {
  return warmups.has(player.id) || resolving.has(player.id);
}

/**
 * Checks everything that can stop a teleport before it starts. Safe to call from a command callback
 * (it only reads). `mover` is checked for combat, `payer` (default the mover) for cooldown and price.
 */
export function checkTeleport(kind: TeleportKind, mover: Player, payer: Player = mover): DenialInfo | undefined {
  if (isTeleporting(mover)) return { denial: "busy", who: mover };
  const rules = getTeleportSettings().rules[kind];

  if (!canBypassTeleportRules(mover) && !rules.allowInCombat && isInCombat(mover)) {
    return { denial: "combat", who: mover };
  }
  if (canBypassTeleportRules(payer)) return undefined;

  const left = getCooldownLeftMs(kind, payer);
  if (left > 0) return { denial: "cooldown", who: payer, detail: t("bus.teleport.cooldown_left", formatDuration(left)) };

  if (rules.cost > 0 && getBalance(payer) < rules.cost) {
    return { denial: "cost", who: payer, detail: t("bus.teleport.cost_needed", rules.cost, getShop().currencyName) };
  }
  return undefined;
}

/** Turns a denial into the command's own response, with the detail (time left, price) on the action bar. */
export function denialResult(origin: CustomCommandOrigin, info: DenialInfo): CustomCommandResult {
  if (info.detail) {
    const detail = info.detail;
    system.run(() => {
      try {
        if (info.who.isValid) info.who.onScreenDisplay.setActionBar(detail);
      } catch {
        // player left
      }
    });
  }
  return reply(origin, CustomCommandStatus.Failure, `bus.teleport.denied.${info.denial}`, FALLBACKS[info.denial]);
}

const FALLBACKS: Record<TeleportDenial, string> = {
  cooldown: "You have to wait before you can teleport again.",
  combat: "You can't teleport while in combat.",
  cost: "You can't afford that teleport.",
  busy: "You are already teleporting.",
};

/** Tells a player (in chat) why a teleport was refused. */
export function tellDenial(info: DenialInfo): void {
  tell(info.who, t(`bus.teleport.denied.${info.denial}`));
  if (info.detail) tell(info.who, info.detail);
}

/**
 * Starts a teleport: checks, warm-up, move. Call inside system.run when coming from a command callback
 * or a before-event. Returns false if it was refused right away.
 */
export function beginTeleport(req: TeleportRequest): boolean {
  const mover = req.mover;
  const payer = req.payer ?? mover;
  const denied = checkTeleport(req.kind, mover, payer);
  if (denied) {
    tellDenial(denied);
    req.onCancelled?.();
    return false;
  }

  const seconds = canBypassTeleportRules(mover) ? 0 : getTeleportSettings().rules[req.kind].warmup;
  if (seconds <= 0) {
    void complete(req);
    return true;
  }

  warmups.set(mover.id, {
    req,
    start: mover.location,
    dimensionId: mover.dimension.id,
    endTick: system.currentTick + seconds * 20,
    lastSecond: -1,
  });
  ensureLoop();
  ensureHurtListener();
  return true;
}

/** Cancels a waiting teleport (e.g. the player used /bus:tpcancel). Returns true if one was waiting. */
export function cancelWarmup(player: Player, reasonKey?: string): boolean {
  const w = warmups.get(player.id);
  if (!w) return false;
  warmups.delete(player.id);
  if (reasonKey) tell(player, t(reasonKey));
  clearBar(player);
  w.req.onCancelled?.();
  return true;
}

function clearBar(player: Player): void {
  try {
    if (player.isValid) player.onScreenDisplay.setActionBar("");
  } catch {
    // player left
  }
}

// ---- warm-up loop -----------------------------------------------------------------------------
let loop: number | undefined;

function ensureLoop(): void {
  if (loop === undefined) loop = system.runInterval(tickWarmups, 5);
}

function tickWarmups(): void {
  const s = getTeleportSettings();
  for (const [id, w] of [...warmups]) {
    const p = w.req.mover;
    if (!p.isValid) {
      warmups.delete(id);
      w.req.onCancelled?.();
      continue;
    }
    if (s.cancelOnMove && hasMoved(p, w)) {
      cancelWarmup(p, "bus.teleport.cancelled_move");
      continue;
    }
    if (!s.rules[w.req.kind].allowInCombat && isInCombat(p)) {
      cancelWarmup(p, "bus.teleport.cancelled_combat");
      continue;
    }
    const left = w.endTick - system.currentTick;
    if (left <= 0) {
      warmups.delete(id);
      clearBar(p);
      void complete(w.req);
      continue;
    }
    const secs = Math.ceil(left / 20);
    p.onScreenDisplay.setActionBar(t("bus.teleport.countdown", secs));
    if (secs !== w.lastSecond) {
      w.lastSecond = secs;
      if (s.sounds) p.playSound("random.click");
    }
  }
  if (warmups.size === 0 && loop !== undefined) {
    system.clearRun(loop);
    loop = undefined;
  }
}

function hasMoved(p: Player, w: Warmup): boolean {
  if (p.dimension.id !== w.dimensionId) return true;
  const l = p.location;
  const dx = l.x - w.start.x;
  const dy = l.y - w.start.y;
  const dz = l.z - w.start.z;
  return dx * dx + dy * dy + dz * dz > 0.25; // more than half a block
}

// ---- damage cancel (subscribed the first time a warm-up starts) ---------------------------------
let hurtHooked = false;

function ensureHurtListener(): void {
  if (hurtHooked) return;
  hurtHooked = true;
  world.afterEvents.entityHurt.subscribe(({ hurtEntity, damage }) => {
    if (!(hurtEntity instanceof Player) || damage <= 0) return;
    if (!warmups.has(hurtEntity.id) || !getTeleportSettings().cancelOnDamage) return;
    cancelWarmup(hurtEntity, "bus.teleport.cancelled_damage");
  });
}

// ---- the move ---------------------------------------------------------------------------------
async function complete(req: TeleportRequest): Promise<void> {
  const mover = req.mover;
  const payer = req.payer ?? mover;
  const rules = getTeleportSettings().rules[req.kind];
  resolving.add(mover.id);

  const fail = (key: string): void => {
    resolving.delete(mover.id);
    tell(mover, t(key));
    if (payer.id !== mover.id && key.startsWith("bus.teleport.denied")) tell(payer, t(key));
    req.onCancelled?.();
  };

  try {
    if (!mover.isValid) {
      resolving.delete(mover.id);
      req.onCancelled?.();
      return;
    }
    if (!canBypassTeleportRules(mover) && !rules.allowInCombat && isInCombat(mover)) {
      fail("bus.teleport.denied.combat");
      return;
    }
    system.run(() => {
      if (mover.isValid) mover.onScreenDisplay.setActionBar(t("bus.teleport.searching"));
    });
    const dest = await req.resolve();
    if (!mover.isValid) {
      resolving.delete(mover.id);
      req.onCancelled?.();
      return;
    }
    if (!dest) {
      fail("bus.teleport.no_destination");
      return;
    }

    system.run(() => {
      resolving.delete(mover.id);
      if (!mover.isValid) {
        req.onCancelled?.();
        return;
      }
      const charge = payer.isValid && !canBypassTeleportRules(payer) ? rules.cost : 0;
      if (charge > 0 && !tryRemoveBalance(payer, charge)) {
        tell(payer, t("bus.teleport.denied.cost"));
        clearBar(mover);
        req.onCancelled?.();
        return;
      }
      try {
        mover.teleport(dest.location, { dimension: dest.dimension });
      } catch (e) {
        console.warn(`[bus:teleport] teleport failed: ${e}`);
        if (charge > 0) tryRefund(payer, charge);
        tell(mover, t("bus.teleport.no_destination"));
        clearBar(mover);
        req.onCancelled?.();
        return;
      }
      if (rules.cooldown > 0 && payer.isValid && !canBypassTeleportRules(payer)) {
        cooldowns.set(cooldownKey(req.kind, payer), Date.now() + rules.cooldown * 1000);
      }
      clearBar(mover);
      mover.sendMessage(t("bus.teleport.arrived"));
      if (getTeleportSettings().sounds) mover.playSound("mob.endermen.portal");
      if (charge > 0) payer.sendMessage(t("bus.teleport.charged", charge, getShop().currencyName));
      req.onArrived?.(mover);
    });
  } catch (e) {
    console.warn(`[bus:teleport] ${e}`);
    fail("bus.teleport.error");
  }
}

function tryRefund(player: Player, amount: number): void {
  try {
    addBalance(player, amount);
  } catch {
    // best effort
  }
}
