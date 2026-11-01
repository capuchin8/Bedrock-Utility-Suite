import { MolangVariableMap, system, world } from "@minecraft/server";
import { getImages, onImagesChanged, type FloatingImage } from "./floatingImageStore";

/** Particle identifier (resource_packs/Bedrock Utility Suite/particles/logo.json). */
export const FLOATING_IMAGE_PARTICLE = "bus:logo";

/**
 * Players closer than this (blocks) are shown every image. There is no documented particle render
 * limit and scripts can't read a player's render distance, so this is one generous value for all
 * images; the game decides what it actually draws.
 */
const VIEW_DISTANCE = 128;

/** How often players are checked against the images (ticks). This is the only polling; it runs only while images exist. */
const CHECK_TICKS = 20;
/** Must match the particle's lifetime, which comes from variable.bus_life. */
const PARTICLE_LIFETIME_SECONDS = 10;
const PARTICLE_LIFETIME_TICKS = PARTICLE_LIFETIME_SECONDS * 20;
/** A player gets a fresh particle this many ticks before the old one ends, so it never blinks out. */
const RESPAWN_MARGIN_TICKS = 30;

/**
 * Particles are client-side: whoever was out of range when one was spawned never sees it. So each
 * image is spawned per player (Player.spawnParticle, visible only to that player), when they come
 * within VIEW_DISTANCE of it, and again just before it expires while they stay.
 * image id -> player id -> tick at which that player's current particle ends.
 */
const shown = new Map<string, Map<string, number>>();
let loop: number | undefined;

function variablesFor(image: FloatingImage): MolangVariableMap {
  const molang = new MolangVariableMap();
  molang.setFloat("variable.bus_width", image.width);
  molang.setFloat("variable.bus_height", image.height);
  molang.setFloat("variable.bus_roll", image.rotation);
  molang.setFloat("variable.bus_life", PARTICLE_LIFETIME_SECONDS);
  molang.setVector3("variable.bus_dir", { x: image.dx, y: image.dy, z: image.dz });
  return molang;
}

function update(): void {
  const images = getImages();
  if (images.length === 0) {
    stop();
    return;
  }

  const now = system.currentTick;
  const liveIds = new Set<string>();

  for (const image of images) {
    liveIds.add(image.id);
    let players;
    try {
      players = world
        .getDimension(image.dimension)
        .getPlayers({ location: { x: image.x, y: image.y, z: image.z }, maxDistance: VIEW_DISTANCE });
    } catch {
      continue; // unknown dimension (for example from a removed pack)
    }

    let perPlayer = shown.get(image.id);
    if (!perPlayer) shown.set(image.id, (perPlayer = new Map()));

    // Players that left the range are forgotten, so coming back shows the image straight away.
    const inRange = new Set(players.map((p) => p.id));
    for (const playerId of perPlayer.keys()) if (!inRange.has(playerId)) perPlayer.delete(playerId);

    let molang: MolangVariableMap | undefined;
    for (const player of players) {
      const endsAt = perPlayer.get(player.id);
      if (endsAt !== undefined && endsAt - RESPAWN_MARGIN_TICKS > now) continue;
      try {
        player.spawnParticle(
          FLOATING_IMAGE_PARTICLE,
          { x: image.x, y: image.y, z: image.z },
          (molang ??= variablesFor(image))
        );
        perPlayer.set(player.id, now + PARTICLE_LIFETIME_TICKS);
      } catch {
        // chunk not loaded for this position, or the player just left: try again next check
      }
    }
  }

  for (const id of shown.keys()) if (!liveIds.has(id)) shown.delete(id);
}

function start(): void {
  if (loop === undefined) loop = system.runInterval(update, CHECK_TICKS);
}

function stop(): void {
  if (loop !== undefined) system.clearRun(loop);
  loop = undefined;
  shown.clear();
}

/** Runs the loop only while at least one image exists. */
function sync(changedId?: string): void {
  // An edited image is sent to everyone again right away (old particles fade within their lifetime).
  if (changedId) shown.delete(changedId);
  if (getImages().length > 0) {
    start();
    // Don't wait for the next check: show a new or edited image at once.
    if (changedId) update();
  } else {
    stop();
  }
}

onImagesChanged(sync);
// Stored images are only readable once the world has loaded, so the first check is deferred.
system.run(() => sync());
