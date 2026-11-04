// What Meta's AI has learned about one game, saved between rounds in data/worlds/<game id>.json:
// rules for the world model, and strategy for each character's mind.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config.ts";

export interface GameLessons {
  rounds: number; // rounds learned from
  summary: string; // what the last round taught, for the player to read
  world: string[]; // how this world works
  minds: Record<string, string[]>; // per character: what works against this player
}

export const WORLDS_DIR = join(ROOT, "data", "worlds");
const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

export function emptyLessons(): GameLessons {
  return { rounds: 0, summary: "", world: [], minds: {} };
}

const fileOf = (dir: string, game: string) => {
  if (!ID.test(game)) throw new Error(`Bad game id: ${game}`);
  return join(dir, `${game}.json`);
};

export function loadLessons(game: string, dir = WORLDS_DIR): GameLessons {
  const file = fileOf(dir, game);
  if (!existsSync(file)) return emptyLessons();
  return { ...emptyLessons(), ...(JSON.parse(readFileSync(file, "utf8")) as Partial<GameLessons>) };
}

export function saveLessons(game: string, lessons: GameLessons, dir = WORLDS_DIR): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(fileOf(dir, game), JSON.stringify(lessons, null, 2));
}

/** Forgets everything learned about a game, so the next round starts fresh. */
export function forgetLessons(game: string, dir = WORLDS_DIR): void {
  rmSync(fileOf(dir, game), { force: true });
}
