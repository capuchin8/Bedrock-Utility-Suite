/**
 * Core data layer for the Floating Text add-on.
 *
 * Holds the list of dimensions we search, the typed shape of the data
 * stored on "bus:floatingtext<scoreboard>" entities, and the tick loop
 * that keeps floating scoreboards' nameTags up to date.
 *
 * Built against Minecraft Bedrock Script API v26.30:
 *   @minecraft/server     2.8.0
 *   @minecraft/server-ui  2.1.0
 */
import { system, world, Dimension, Entity } from "@minecraft/server";

/**
 * All dimensions we search when looking for floating text entities.
 *
 * This is lazily initialized rather than computed at module load time:
 * top-level module code runs in "early execution mode", where
 * world.getDimension() (and most other world-query calls) is not yet
 * allowed. By deferring the actual calls until getDimensions() is
 * first invoked -- which only happens once a command runs or the tick
 * loop fires, both well after the world has finished loading -- we
 * avoid the "cannot be used in early execution" error.
 */
let cachedDimensions: Dimension[] | undefined;

export function getDimensions(): Dimension[] {
  if (!cachedDimensions) {
    cachedDimensions = [world.getDimension("overworld"), world.getDimension("nether"), world.getDimension("the_end")];
  }
  return cachedDimensions;
}

/** Shape of the data stored in the "scoreboardinfo" dynamic property. */
export interface ScoreboardInfo {
  objectiveId: string;
  sortOrder: "ascending" | "descending";
  enumeratePlayers: boolean;
  hideOfflinePlayers: boolean;
  enumerationColor: string;
  playerNameColor: string;
  scoreColor: string;
  maxListed: number;
}

const SCOREBOARD_ENTITY_TYPE = "bus:floatingtext";
const SCOREBOARD_DYNAMIC_PROPERTY = "scoreboardinfo";

/** The displayName the game uses for a scoreboard entry with no matching online player. */
const OFFLINE_PLAYER_DISPLAY_KEY = "commands.scoreboard.players.offlinePlayerName";

/** Some scoreboard participants use this key to show a friendlier name. */
const specialParticipantNames: Record<string, string> = {
  [OFFLINE_PLAYER_DISPLAY_KEY]: "Offline Player",
};

/** Reads and parses the ScoreboardInfo stored on an entity, if any. */
export function readScoreboardInfo(entity: Entity): ScoreboardInfo | undefined {
  const raw = entity.getDynamicProperty(SCOREBOARD_DYNAMIC_PROPERTY);
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw) as ScoreboardInfo;
  } catch {
    return undefined;
  }
}

/** Serializes and stores a ScoreboardInfo onto an entity. */
export function writeScoreboardInfo(entity: Entity, info: ScoreboardInfo): void {
  entity.setDynamicProperty(SCOREBOARD_DYNAMIC_PROPERTY, JSON.stringify(info));
}

/**
 * Every 20 ticks (1 second), refresh the nameTag of every floating
 * scoreboard entity so it reflects the current scoreboard state.
 */
system.runInterval(() => {
  const scoreboard = world.scoreboard;

  for (const dimension of getDimensions()) {
    for (const entity of dimension.getEntities({
      type: SCOREBOARD_ENTITY_TYPE,
      families: ["scoreboard"],
    })) {
      const info = readScoreboardInfo(entity);
      if (!info) {
        entity.remove();
        continue;
      }

      const objective = scoreboard.getObjective(info.objectiveId);
      if (!objective) {
        entity.remove();
        continue;
      }

      const scores = objective
        .getScores()
        .filter(({ participant }) => !participant.displayName.startsWith("#"))
        .filter(
          ({ participant }) => !info.hideOfflinePlayers || participant.displayName !== OFFLINE_PLAYER_DISPLAY_KEY
        );

      scores.sort((a, b) => (info.sortOrder === "ascending" ? a.score - b.score : b.score - a.score));

      const lines = scores.slice(0, info.maxListed).map(({ participant: { displayName }, score }, i) => {
        const prefix = info.enumeratePlayers ? `${info.enumerationColor}${i + 1}. ` : "";
        const name = specialParticipantNames[displayName] ?? displayName;
        return `${prefix}${info.playerNameColor}${name}§r ${info.scoreColor}${score}§r`;
      });

      entity.nameTag = `${objective.displayName}§r\n${lines.join("\n")}`;
    }
  }
}, 20);
