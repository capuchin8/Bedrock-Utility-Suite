import { system, world } from "@minecraft/server";

const MAX_VOID_DIMENSIONS = 16;

function buildVoidDimensionId(index: number): string {
  return `bus:void_${index.toString().padStart(2, "0")}`;
}

/**
 * Reads current pack settings and returns every dimension ID that should
 * exist this session. Safe in early-execution (startup) and normal
 * execution (e.g. building a travel menu later).
 */
export function getConfiguredDimensionIds(): string[] {
  const settings = world.getPackSettings();
  const ids: string[] = [];

  const rawCount = settings["bus:void_dimension_count"];
  const count = typeof rawCount === "number" ? Math.min(Math.max(Math.round(rawCount), 0), MAX_VOID_DIMENSIONS) : 0;
  for (let i = 1; i <= count; i++) {
    ids.push(buildVoidDimensionId(i));
  }

  const namedSelection = settings["bus:named_dimensions"] as unknown;
  if (Array.isArray(namedSelection)) {
    for (const name of namedSelection) {
      if (typeof name === "string") {
        ids.push(`bus:${name}`);
      }
    }
  }

  return ids;
}

system.beforeEvents.startup.subscribe((event) => {
  for (const id of getConfiguredDimensionIds()) {
    event.dimensionRegistry.registerCustomDimension(id);
  }
});
