import { Player, ItemStack, EquipmentSlot } from "@minecraft/server";

export interface PickerResult {
    item: ItemStack;
    slot: null; // no inventory slot concept here — kept for interface parity
}

/**
 * Resolves to whatever the player is currently holding in their mainhand,
 * or null if their hand is empty.
 *
 * Same async signature as the earlier picker approaches, so this is a
 * drop-in replacement for showItemPicker() wherever it's called.
 */
export async function showItemPicker(player: Player): Promise<PickerResult | null> {
    const equippable = player.getComponent("minecraft:equippable");
    const held = equippable?.getEquipment(EquipmentSlot.Mainhand);

    if (!held) return null;

    return { item: held.clone(), slot: null };
}
