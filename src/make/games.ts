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

/** What a game uses, read from its code, for the gallery's badges. */
export interface Features {
  world: boolean; // Meta's world model and minds while it runs
  people: boolean; // real people (Rocketbox)
  scanned: boolean; // real scanned models, surfaces or skies (Poly Haven)
  shot: boolean; // a screenshot from its test
}

export function featuresOf(code: string, id: string): Features {
  return {
    world: /kit\.(world|mind)\(/.test(code),
    // A Rocketbox name anywhere in the code, such as "Security_Male_01" or "Female_Adult_05".
    people: /["'`](?:[A-Z][a-z]+_(?:Male|Female)|(?:Male|Female)_(?:Adult|Child))_\d\d["'`]/.test(code),
    scanned: /["'`]polyhaven\//.test(code),
    shot: existsSync(join(GAMES_DIR, `${id}.png`)),
  };
}

export function listGames(): (Omit<Game, "code"> & { features: Features })[] {
  if (!existsSync(GAMES_DIR)) return [];
  return readdirSync(GAMES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const { code, ...rest } = JSON.parse(readFileSync(join(GAMES_DIR, file), "utf8")) as Game;
      return { ...rest, features: featuresOf(code, rest.id) };
    })
    .sort((a, b) => b.made.localeCompare(a.made));
}

/** Loads a game by id. Ids are checked so they can't reach outside the folder. */
export function loadGame(id: string): Game | null {
  if (!ID.test(id)) return null;
  const file = join(GAMES_DIR, `${id}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Game) : null;
}
