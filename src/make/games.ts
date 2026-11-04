// Games the AI wrote are saved in data/games/ (ignored by git): the code, and a screenshot from the test.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config.ts";

export const GAMES_DIR = join(ROOT, "data", "games");
const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

export interface Game {
  id: string;
  title: string;
  pitch: string;
  controls: string;
  example?: string; // something to say to the world model while playing (games made since Oct 30)
  code: string;
  prompt: string;
  model: string;
  made: string; // when, as an ISO date
}

export function gameId(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "game"
  );
}

export function saveGame(game: Game, screenshot?: Buffer | null): void {
  mkdirSync(GAMES_DIR, { recursive: true });
  writeFileSync(join(GAMES_DIR, `${game.id}.json`), JSON.stringify(game, null, 2));
  if (screenshot) writeFileSync(join(GAMES_DIR, `${game.id}.png`), screenshot);
}

export function listGames(): Omit<Game, "code">[] {
  if (!existsSync(GAMES_DIR)) return [];
  return readdirSync(GAMES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const { code, ...rest } = JSON.parse(readFileSync(join(GAMES_DIR, file), "utf8")) as Game;
      return rest;
    })
    .sort((a, b) => b.made.localeCompare(a.made));
}

/** Loads a game by id. Ids are checked so they can't reach outside the folder. */
export function loadGame(id: string): Game | null {
  if (!ID.test(id)) return null;
  const file = join(GAMES_DIR, `${id}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Game) : null;
}
