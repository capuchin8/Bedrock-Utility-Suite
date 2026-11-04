import { CustomForm } from "@minecraft/server-ui";
import type { Player } from "@minecraft/server";
import { t } from "../../core/lang";
import { getAntiCheatModules } from "../../antiCheat/antiCheatRegistry";
import { createGuard } from "../guard";
import { showForm } from "../openForm";
import { registerSettingsSection } from "../registry";

const KEY = "bus:anti_cheat";

function openHub(player: Player, back: () => void): void {
  const guard = createGuard(player, KEY);
  if (!guard.check()) return;
  showForm(player, () => {
    const form = guard.attach(new CustomForm(player, t("bus.section.anti_cheat.title")));
    for (const module of getAntiCheatModules()) {
      form.button(
        module.title,
        guard.click(() => {
          form.close();
          module.open(player, () => openHub(player, back));
        })
      );
    }
    form.button(t("bus.common.back"), () => {
      form.close();
      back();
    });
    return form.closeButton();
  });
}

registerSettingsSection({
  id: KEY,
  title: t("bus.section.anti_cheat.title"),
  description: t("bus.section.anti_cheat.desc"),
  order: 70,
  defaultEveryone: false,
  defaultOperators: true,
  open: openHub,
});
