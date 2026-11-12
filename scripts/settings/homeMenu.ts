import type { Player } from "@minecraft/server";
import { CustomForm } from "@minecraft/server-ui";
import { t } from "../core/lang";
import { canUse } from "../permissions/permissionStore";
import { offerOwnershipClaim } from "./claimPrompt";
import { showForm } from "./openForm";
import { getSections, isBlockedByCheats } from "./registry";

export function openSettingsHome(player: Player): void {
  // No owner yet and this player is an operator: offer to claim ownership first, then carry on.
  if (offerOwnershipClaim(player, () => openSettingsHome(player))) return;

  const sections = getSections().filter((s) => canUse(player, s.id));
  if (sections.length === 0) {
    player.sendMessage(t("bus.settings.no_access"));
    return;
  }

  showForm(player, () => {
    const form = new CustomForm(player, t("bus.settings.title"));
    form.label(t("bus.settings.choose"));
    form.spacer();

    for (const section of sections) {
      // A menu that needs cheats is greyed out (with the reason as its tooltip) while they are off.
      const needsCheats = isBlockedByCheats(section.id);
      form.button(
        section.title,
        () => {
          // Re-check at click time in case permissions or cheats changed while the form was open.
          if (!canUse(player, section.id) || isBlockedByCheats(section.id)) {
            form.close();
            player.sendMessage(
              t(isBlockedByCheats(section.id) ? "bus.settings.cheats_required" : "bus.settings.access_revoked")
            );
            return;
          }
          form.close();
          section.open(player, () => openSettingsHome(player));
        },
        {
          disabled: needsCheats,
          ...(needsCheats
            ? { tooltip: t("bus.settings.cheats_required") }
            : section.description
              ? { tooltip: section.description }
              : {}),
        }
      );
    }

    return form.closeButton();
  });
}
