import { world } from "@minecraft/server";

// world.allowCheats is pre-release (beta). It is reached through a local type so the add-on still
// loads when Beta APIs are off; in that case the cheats state is unknown and treated as "on", so a
// menu that asks for cheats is not locked away for everyone.
export function cheatsEnabled(): boolean {
  try {
    const value = (world as unknown as { allowCheats?: boolean }).allowCheats;
    return typeof value === "boolean" ? value : true;
  } catch {
    return true;
  }
}
