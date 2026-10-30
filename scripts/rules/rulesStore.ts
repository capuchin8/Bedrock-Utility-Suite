import type { Player } from "@minecraft/server";
import { t } from "../core/lang";
import { isRecord, readWorldJson, writeWorldJson } from "../core/storage";
import { isOperator, isOwner } from "../permissions/permissionStore";
import { registerShareable } from "../share/shareRegistry";

const KEY = "bus:rules";
const ACCEPTED_KEY = "bus:rules_accepted"; // player property: the rules version they accepted
export const MAX_RULES = 30;

export interface RulesSettings {
  enabled: boolean;
  title: string;
  /** Optional text above the rules. {name} = the reader's name. */
  preface: string;
  /** Optional text below the rules. {name} = the reader's name. */
  footer: string;
  /** One entry per rule, shown as a numbered list. */
  rules: string[];
  /** Bumped when the owner requires everyone to accept again. */
  version: number;
  /** Show "1." "2." ... in front of each rule. */
  numbered: boolean;
  /** Operators don't have to accept (the owner never does, so they can't lock themselves out). */
  exemptOperators: boolean;
}

export const DEFAULT_RULES: RulesSettings = {
  enabled: false,
  title: "Server Rules",
  preface: "",
  footer: "",
  rules: [],
  version: 1,
  exemptOperators: true,
  numbered: true,
};

export function normalizeRules(v: unknown): RulesSettings | undefined {
  if (!isRecord(v)) return undefined;
  const d = DEFAULT_RULES;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : d.enabled,
    title: typeof v.title === "string" ? v.title.slice(0, 64) : d.title,
    preface: typeof v.preface === "string" ? v.preface.slice(0, 500) : d.preface,
    footer: typeof v.footer === "string" ? v.footer.slice(0, 500) : d.footer,
    rules: Array.isArray(v.rules)
      ? v.rules
          .filter((r): r is string => typeof r === "string")
          .slice(0, MAX_RULES)
          .map((r) => r.slice(0, 300))
      : [],
    version:
      typeof v.version === "number" && Number.isFinite(v.version) ? Math.max(1, Math.round(v.version)) : d.version,
    exemptOperators: typeof v.exemptOperators === "boolean" ? v.exemptOperators : d.exemptOperators,
    numbered: typeof v.numbered === "boolean" ? v.numbered : d.numbered,
  };
}

export function getRulesSettings(): RulesSettings {
  return normalizeRules(readWorldJson<unknown>(KEY, {})) ?? DEFAULT_RULES;
}

export function saveRulesSettings(patch: Partial<RulesSettings>): void {
  const next = normalizeRules({ ...getRulesSettings(), ...patch });
  if (next) writeWorldJson(KEY, next);
}

export function hasAcceptedRules(player: Player): boolean {
  const v = player.getDynamicProperty(ACCEPTED_KEY);
  return typeof v === "number" && v >= getRulesSettings().version;
}

export function markRulesAccepted(player: Player): void {
  player.setDynamicProperty(ACCEPTED_KEY, getRulesSettings().version);
}

/** Does this player still have to accept the rules before playing? */
export function mustAcceptRules(player: Player): boolean {
  const s = getRulesSettings();
  if (!s.enabled || s.rules.filter((r) => r.trim()).length === 0) return false;
  if (isOwner(player) || (s.exemptOperators && isOperator(player))) return false;
  return !hasAcceptedRules(player);
}

registerShareable({
  id: KEY,
  label: t("bus.share.rules"),
  export: () => getRulesSettings(),
  import: (data) => {
    const next = normalizeRules(data);
    if (!next) return t("bus.share.error.generic");
    // Keep the local version number so imports never silently re-prompt (or skip) players.
    writeWorldJson(KEY, { ...next, version: getRulesSettings().version });
    return undefined;
  },
});
