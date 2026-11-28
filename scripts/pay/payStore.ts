import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";
import { t } from "../core/lang";
import { registerShareable } from "../share/shareRegistry";

const KEY = "bus:pay";
export const MAX_PAY = 2_000_000_000;

export type TaxMode = "deduct" | "add";

export interface PayConfig {
  /** false = /bus:pay refuses everyone. */
  enabled: boolean;
  /** Smallest payment (at least 1). */
  minAmount: number;
  /** Largest single payment. 0 = no limit. */
  maxAmount: number;
  /** Most one player may send in any rolling 24 hours (counts the amount before tax). 0 = no limit. */
  dailyLimit: number;
  /** Seconds a player must wait between payments. 0 = none. Resets when the world reloads. */
  cooldownSeconds: number;
  /** Tax in percent (0-100, up to 2 decimals). The tax is removed from the economy. */
  taxPercent: number;
  /** "deduct": the receiver gets the amount minus tax. "add": the sender pays the amount plus tax. */
  taxMode: TaxMode;
}

export const DEFAULT_PAY: PayConfig = {
  enabled: true,
  minAmount: 1,
  maxAmount: 0,
  dailyLimit: 0,
  cooldownSeconds: 0,
  taxPercent: 0,
  taxMode: "deduct",
};

function int(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fallback;
}

export function normalizePay(v: unknown): PayConfig {
  const d = DEFAULT_PAY;
  if (!isRecord(v)) return { ...d };
  const tax =
    typeof v.taxPercent === "number" && Number.isFinite(v.taxPercent)
      ? Math.round(Math.max(0, Math.min(100, v.taxPercent)) * 100) / 100
      : d.taxPercent;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : d.enabled,
    minAmount: int(v.minAmount, 1, MAX_PAY, d.minAmount),
    maxAmount: int(v.maxAmount, 0, MAX_PAY, d.maxAmount),
    dailyLimit: int(v.dailyLimit, 0, MAX_PAY, d.dailyLimit),
    cooldownSeconds: int(v.cooldownSeconds, 0, 86_400, d.cooldownSeconds),
    taxPercent: tax,
    taxMode: v.taxMode === "add" ? "add" : "deduct",
  };
}

let cache: PayConfig | undefined;

export function getPay(): PayConfig {
  return (cache ??= normalizePay(readWorldJson<unknown>(KEY, undefined)));
}

export function savePay(): void {
  writeWorldJson(KEY, getPay());
}

registerShareable({
  id: KEY,
  label: t("bus.share.pay"),
  export: () => ({ ...getPay() }),
  import: (data) => {
    if (!isRecord(data)) return t("bus.share.pay.invalid");
    cache = normalizePay(data);
    savePay();
    return undefined;
  },
});
