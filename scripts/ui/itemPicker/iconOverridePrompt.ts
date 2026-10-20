import { Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { getIconOverride, setIconOverride, clearIconOverride } from "./iconOverrideStore";

/**
 * Shows an admin a text field to manually set (or clear) the resource pack
 * texture path used as an item's shop icon. Intended as the fallback for
 * items resolveItemIcon() can't figure out on its own (third-party/modded
 * items — see itemIconMap.ts for why that can't be automatic).
 */
export async function promptIconOverride(player: Player, typeId: string): Promise<void> {
    const current = getIconOverride(typeId) ?? "";

    const form = new ModalFormData()
        .title("Set Item Icon")
        .textField(
            `Texture path for ${typeId}`,
            "e.g. textures/items/diamond_sword",
            { defaultValue: current }
        );

    const response = await form.show(player);
    if (response.canceled) return;

    const path = (response.formValues?.[0] as string)?.trim() ?? "";

    if (!path) {
        clearIconOverride(typeId);
        player.sendMessage(`§7Cleared icon override for §f${typeId}§7.`);
        return;
    }

    const saved = setIconOverride(typeId, path);
    if (saved) {
        player.sendMessage(`§aIcon set for §f${typeId}§a: §7${path}`);
    } else {
        player.sendMessage(`§cCouldn't save — item id is too long to store an override for.`);
    }
}
