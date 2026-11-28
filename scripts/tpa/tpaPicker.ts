import type { Player } from "@minecraft/server";
import { CustomForm } from "@minecraft/server-ui";
import { t } from "../core/lang";
import { showForm } from "../settings/openForm";
import { stripFormatting } from "../roles/display";
import { getVisibleEntries, getVisibleName } from "../vanish/visibility";
import { findPlayerById, getIncoming, type TpaRequest } from "./tpaStore";

/** A button per player `viewer` is allowed to see (vanished players hidden, nicknames for non-staff). */
export function openPlayerPicker(viewer: Player, titleKey: string, onPick: (target: Player) => void): void {
  showForm(viewer, () => {
    const form = new CustomForm(viewer, t(titleKey));
    const entries = getVisibleEntries(viewer).filter((e) => e.player.id !== viewer.id);
    if (entries.length === 0) form.label(t("bus.tpa.picker.empty"));
    for (const { player, label } of entries) {
      // Button text can't render § codes, so strip them.
      form.button(stripFormatting(label), () => {
        form.close();
        onPick(player);
      });
    }
    form.divider().button(t("bus.common.cancel"), () => form.close());
    return form.closeButton();
  });
}

/** Lists the requests waiting for `viewer`; pressing one picks it. */
export function openIncomingPicker(viewer: Player, titleKey: string, onPick: (req: TpaRequest) => void): void {
  showForm(viewer, () => {
    const form = new CustomForm(viewer, t(titleKey));
    const reqs = getIncoming(viewer.id);
    if (reqs.length === 0) form.label(t("bus.tpa.none"));
    for (const req of reqs) {
      const from = findPlayerById(req.fromId);
      if (!from) continue;
      const name = stripFormatting(getVisibleName(viewer, from));
      form.button({ rawtext: [{ text: `${name} - ` }, t(req.kind === "tpa" ? "bus.tpa.kind.to_you" : "bus.tpa.kind.to_them")] }, () => {
        form.close();
        onPick(req);
      });
    }
    form.divider().button(t("bus.common.cancel"), () => form.close());
    return form.closeButton();
  });
}
