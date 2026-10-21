// Fix this import path to wherever your generated item icon map lives.
import { resolveItemIcon } from "../ui/itemPicker/itemIconMap";

export function getIconFor(itemId: string, override?: string): string {
  if (override) return override;
  try {
    const resolved = resolveItemIcon(itemId);
    if (resolved) return resolved;
  } catch {
    // fall through
  }
  return `textures/items/${itemId.replace(/^[a-z0-9_.-]+:/, "")}`;
}
