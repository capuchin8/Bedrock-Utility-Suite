import type { Player } from "@minecraft/server";
import { CustomForm } from "@minecraft/server-ui";
import { t } from "../core/lang";
import { addListedOwner } from "../permissions/owners";
import { canClaimOwnership } from "../permissions/ownership";
import { showForm } from "./openForm";

// Players who chose "Not now". In memory only: they are asked again after a script reload,
// but not every time they go back to the home menu.
const declined = new Set<string>();

/**
 * If this player could claim ownership (an operator, no owner exists yet), shows the claim screen and
 * returns true; `proceed` runs afterwards whichever button was pressed. Returns false (and shows
 * nothing) when there is nothing to offer, so the caller carries on as normal.
 */
export function offerOwnershipClaim(player: Player, proceed: () => void): boolean {
  if (declined.has(player.id) || !canClaimOwnership(player)) return false;

  showForm(player, () => {
    const form = new CustomForm(player, t("bus.claim.title"));
    form.label(t("bus.claim.body"));
    form.spacer();
    form.button(t("bus.claim.confirm"), () => {
      form.close();
      // Re-check: someone may have claimed ownership while this screen was open.
      if (canClaimOwnership(player)) addListedOwner(player.id, player.name);
      proceed();
    });
    form.button(t("bus.claim.later"), () => {
      declined.add(player.id);
      form.close();
      proceed();
    });
    return form.closeButton();
  });
  return true;
}
