import { t } from "../../core/lang";
import { registerShareable } from "../../share/shareRegistry";
import {
  ANTI_DUPE_RULES,
  areAntiDupeAlertsEnabled,
  isAntiDupeEnabled,
  isRuleEnabled,
  setAntiDupeAlerts,
  setAntiDupeEnabled,
  setRuleEnabled,
} from "./antiDupeStore";

registerShareable({
  id: "bus:anti_dupe",
  label: t("bus.share.anti_dupe"),
  export: () => ({
    enabled: isAntiDupeEnabled(),
    alerts: areAntiDupeAlertsEnabled(),
    rules: Object.fromEntries(ANTI_DUPE_RULES.map((rule) => [rule, isRuleEnabled(rule)])),
  }),
  import: (data) => {
    // validate first, then apply
    if (typeof data !== "object" || data === null) return t("bus.share.anti_dupe.invalid");
    const d = data as Record<string, unknown>;
    if (typeof d.enabled !== "boolean" || typeof d.alerts !== "boolean") return t("bus.share.anti_dupe.invalid");
    const rules: Partial<Record<(typeof ANTI_DUPE_RULES)[number], boolean>> = {};
    if (d.rules !== undefined) {
      if (typeof d.rules !== "object" || d.rules === null) return t("bus.share.anti_dupe.invalid");
      const r = d.rules as Record<string, unknown>;
      for (const rule of ANTI_DUPE_RULES) {
        if (r[rule] === undefined) continue;
        if (typeof r[rule] !== "boolean") return t("bus.share.anti_dupe.invalid");
        rules[rule] = r[rule];
      }
    }
    setAntiDupeEnabled(d.enabled);
    setAntiDupeAlerts(d.alerts);
    for (const rule of ANTI_DUPE_RULES) {
      const value = rules[rule];
      if (value !== undefined) setRuleEnabled(rule, value);
    }
    return undefined;
  },
});
