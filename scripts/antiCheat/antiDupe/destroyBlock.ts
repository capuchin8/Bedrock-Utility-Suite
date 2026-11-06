import type { Dimension, Vector3 } from "@minecraft/server";

/**
 * Breaks a block and drops it as an item, like `/setblock x y z air destroy`.
 * Returns true if the command ran.
 */
export function destroyBlock(dimension: Dimension, location: Vector3): boolean {
  try {
    dimension.runCommand(
      `setblock ${Math.floor(location.x)} ${Math.floor(location.y)} ${Math.floor(location.z)} air destroy`
    );
    return true;
  } catch (e) {
    console.warn(`[bus:anti-dupe] could not destroy block: ${e}`);
    return false;
  }
}
