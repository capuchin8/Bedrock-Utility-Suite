import { system, world, type Player } from "@minecraft/server";
import { onDisplayDataChanged } from "../core/storage";
import { getNickname } from "../nicknames/nicknameStore";
import { colorPrefix } from "./colors";
import { getRoleLabel, getTopRole } from "./display";
import { getDisplaySettings } from "./displaySettings";

// Remembers what we wrote so we only clear name tags that are still ours.
const applied = new Map<string, string>();

function buildTag(player: Player): string | undefined {
  const s = getDisplaySettings();
  const nickname = s.nicknameInNametag ? getNickname(player) : undefined;
  const label = s.nametagEnabled ? getRoleLabel(player) : "";
  if (!nickname && !label) return undefined; // leave the vanilla name tag alone

  const color = s.nametagEnabled ? colorPrefix(getTopRole(player)?.nameColor ?? "") : "";
  const name = `${color}${nickname ?? player.name}§r`;
  if (!label) return name;

  switch (s.nametagPosition) {
    case "above":
      return `${label}\n${name}`;
    case "below":
      return `${name}\n${label}`;
    default:
      // No-break spaces so the client can't wrap the line between role and name (seen while emoting).
      return `${label} ${name}`.replace(/ /g, "\u00A0");
  }
}

export function refreshNameTag(player: Player): void {
  if (!player.isValid) return;
  const desired = buildTag(player);
  const last = applied.get(player.id);

  if (desired === undefined) {
    // Back to vanilla. An empty string would HIDE the name tag, so restore the real name instead.
    if (last !== undefined && player.nameTag === last) player.nameTag = player.name;
    applied.delete(player.id);
    return;
  }
  // Skip the write when unchanged to avoid pointless replication.
  if (player.nameTag !== desired) player.nameTag = desired;
  applied.set(player.id, desired);
}

let scheduled = false;
export function scheduleRefreshAll(): void {
  if (scheduled) return;
  scheduled = true;
  system.run(() => {
    scheduled = false;
    for (const player of world.getAllPlayers()) refreshNameTag(player);
  });
}

// Event-driven only: no polling.
world.afterEvents.playerSpawn.subscribe(({ player }) => refreshNameTag(player));
world.afterEvents.playerLeave.subscribe(({ playerId }) => applied.delete(playerId));
onDisplayDataChanged(scheduleRefreshAll);
