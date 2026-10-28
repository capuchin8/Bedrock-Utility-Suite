import { world, type Player, type ScoreboardObjective } from "@minecraft/server";

import { getShop } from "./shopStore";

let objective: ScoreboardObjective | undefined;

// Created lazily: world.scoreboard can't be touched in early execution (startup).
function getObjective(): ScoreboardObjective {
  const cfg = getShop();
  if (objective?.isValid && objective.id === cfg.objectiveName) return objective;
  objective =
    world.scoreboard.getObjective(cfg.objectiveName) ??
    world.scoreboard.addObjective(cfg.objectiveName, cfg.currencyName);
  return objective;
}

export function getBalance(player: Player): number {
  // getScore throws ("Failed to resolve identity") for a player that has no score on the objective yet.
  try {
    return getObjective().getScore(player) ?? 0;
  } catch {
    return 0;
  }
}

export function setBalance(player: Player, amount: number): void {
  getObjective().setScore(player, Math.floor(amount));
}

export function addBalance(player: Player, amount: number): void {
  setBalance(player, getBalance(player) + amount);
}

export function tryRemoveBalance(player: Player, amount: number): boolean {
  const bal = getBalance(player);
  if (bal < amount) return false;
  setBalance(player, bal - amount);
  return true;
}
