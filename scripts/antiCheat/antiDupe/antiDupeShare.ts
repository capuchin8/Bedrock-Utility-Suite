import { t } from "../../core/lang";
import { registerShareable } from "../../share/shareRegistry";
import { areAntiDupeAlertsEnabled, isAntiDupeEnabled, setAntiDupeAlerts, setAntiDupeEnabled } from "./antiDupeStore";

registerShareable({
  id: "bus:anti_dupe",
  label: t("bus.share.anti_dupe"),
  export: () => ({ enabled: isAntiDupeEnabled(), alerts: areAntiDupeAlertsEnabled() }),
  import: (data) => {
    // validate first, then apply
    if (typeof data !== "object" || data === null) return t("bus.share.anti_dupe.invalid");
    const d = data as Record<string, unknown>;
    if (typeof d.enabled !== "boolean" || typeof d.alerts !== "boolean") return t("bus.share.anti_dupe.invalid");
    setAntiDupeEnabled(d.enabled);
    setAntiDupeAlerts(d.alerts);
    return undefined;
  },
});
