import { t } from "../../core/lang";
import { FLOATING_TEXT_KEY, openFloatingTextMenu } from "../../floatingText/floatingTextMenu";
import { registerSettingsSection } from "../registry";

// Registering the section also registers the "bus:floating_text" permission, so it shows up in
// Settings > Permissions and can be granted to roles. Operators have access until the owner changes it.
registerSettingsSection({
    id: FLOATING_TEXT_KEY,
    title: t("bus.section.floating_text.title"),
    description: t("bus.section.floating_text.desc"),
    order: 55,
    open: (player, back) => openFloatingTextMenu(player, back),
});
