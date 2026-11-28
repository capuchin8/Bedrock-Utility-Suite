import { world, type Player } from "@minecraft/server";
import { addBalance, getBalance, tryRemoveBalance } from "../shop/shopEconomy";
import { getShop } from "../shop/shopStore";
import { getPay } from "./payStore";

const DAILY_PROPERTY = "bus:pay_sent";
const DAY_MS = 86_400_000;
const lastPayment = new Map<string, number>(); // player id -> Date.now() of the last payment (resets on reload)

export type PayError = "disabled" | "min" | "max" | "daily" | "cooldown" | "funds";

export interface Quote {
  /** What leaves the sender's balance. */
  cost: number;
  /** What the receiver gets. */
  received: number;
  /** What disappears from the economy. */
  tax: number;
}

/** Tax is rounded down, so small payments can be tax-free. */
export function quote(amount: number): Quote {
  const cfg = getPay();
  const tax = Math.floor((amount * cfg.taxPercent) / 100);
  return cfg.taxMode === "add"
    ? { cost: amount + tax, received: amount, tax }
    : { cost: amount, received: amount - tax, tax };
}

interface Daily {
  since: number;
  total: number;
}

function readDaily(player: Player): Daily {
  try {
    const raw = player.getDynamicProperty(DAILY_PROPERTY);
    if (typeof raw === "string") {
      const v = JSON.parse(raw) as Partial<Daily>;
      if (typeof v.since === "number" && typeof v.total === "number" && Date.now() - v.since < DAY_MS)
        return { since: v.since, total: v.total };
    }
  } catch {
    // no record yet
  }
  return { since: Date.now(), total: 0 };
}

/** Amount this player may still send in the current 24-hour window (Infinity when there is no daily limit). */
export function dailyRemaining(player: Player): number {
  const limit = getPay().dailyLimit;
  return limit === 0 ? Infinity : Math.max(0, limit - readDaily(player).total);
}

/** Balance without creating the scoreboard objective (safe in restricted-execution callbacks). */
function peekBalance(player: Player): number {
  try {
    return world.scoreboard.getObjective(getShop().objectiveName)?.getScore(player) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Every rule that doesn't need to change anything, so it can run inside a command callback.
 * Returns the first rule that fails, or undefined if the payment is allowed.
 */
export function checkPayment(sender: Player, amount: number): PayError | undefined {
  const cfg = getPay();
  if (!cfg.enabled) return "disabled";
  if (amount < cfg.minAmount) return "min";
  if (cfg.maxAmount > 0 && amount > cfg.maxAmount) return "max";
  if (cfg.cooldownSeconds > 0) {
    const last = lastPayment.get(sender.id);
    if (last !== undefined && Date.now() - last < cfg.cooldownSeconds * 1000) return "cooldown";
  }
  if (cfg.dailyLimit > 0 && amount > dailyRemaining(sender)) return "daily";
  if (peekBalance(sender) < quote(amount).cost) return "funds";
  return undefined;
}

/**
 * Re-checks everything and moves the money. Call inside system.run (it changes scores).
 * Nothing is given unless the sender's money was taken first.
 */
export function applyPayment(sender: Player, receiver: Player, amount: number): PayError | Quote {
  const err = checkPayment(sender, amount);
  if (err) return err;
  const q = quote(amount);
  if (getBalance(sender) < q.cost || !tryRemoveBalance(sender, q.cost)) return "funds";
  addBalance(receiver, q.received);

  lastPayment.set(sender.id, Date.now());
  if (getPay().dailyLimit > 0) {
    const d = readDaily(sender);
    sender.setDynamicProperty(DAILY_PROPERTY, JSON.stringify({ since: d.since, total: d.total + amount }));
  }
  return q;
}
