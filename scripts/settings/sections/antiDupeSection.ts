import { CustomForm, ObservableBoolean } from "@minecraft/server-ui";
import { t } from "../../core/lang";
import { registerAntiCheatModule } from "../../antiCheat/antiCheatRegistry";
import {
  areAntiDupeAlertsEnabled,
  isAntiDupeEnabled,
  setAntiDupeAlerts,
  setAntiDupeEnabled,
} from "../../antiCheat/antiDupe/antiDupeStore";
import { createGuard } from "../guard";
import { showForm } from "../openForm";

// Same permission as the Anti cheat hub: whoever can open Anti cheat can change this.
const KEY = "bus:anti_cheat";

registerAntiCheatModule({
  id: "bus:anti_dupe",
  title: t("bus.section.anti_dupe.title"),
  order: 10,
  open: (player, back) => {
    const guard = createGuard(player, KEY);
    if (!guard.check()) return;
    showForm(player, () => {
      const form = guard.attach(new CustomForm(player, t("bus.section.anti_dupe.title")));

      form.label(t("bus.anti_dupe.intro"));

      const enabled = new ObservableBoolean(isAntiDupeEnabled(), { clientWritable: true });
      form.toggle(t("bus.anti_dupe.enabled"), enabled, { description: t("bus.anti_dupe.enabled.desc") });
      guard.on(enabled, (value: boolean) => setAntiDupeEnabled(value));

      const alerts = new ObservableBoolean(areAntiDupeAlertsEnabled(), { clientWritable: true });
      form.toggle(t("bus.anti_dupe.alerts"), alerts, { description: t("bus.anti_dupe.alerts.desc") });
      guard.on(alerts, (value: boolean) => setAntiDupeAlerts(value));

      form.button(t("bus.common.back"), () => {
        form.close();
        back();
      });
      return form.closeButton();
    });
  },
});
