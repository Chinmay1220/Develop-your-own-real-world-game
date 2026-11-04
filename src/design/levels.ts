// Designed levels are saved as room files in data/levels/, which git ignores.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config.ts";
import { validateRoom } from "../game/room.ts";
import type { Room } from "../game/types.ts";

export const LEVELS_DIR = join(ROOT, "data", "levels");
const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

export function saveLevel(room: Room, dir = LEVELS_DIR): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${room.id}.json`);
  writeFileSync(file, JSON.stringify(room, null, 2));
  return file;
}

export function listLevels(dir = LEVELS_DIR): { id: string; name: string; prompt: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const room = JSON.parse(readFileSync(join(dir, file), "utf8")) as Room;
      return { id: room.id, name: room.name, prompt: room.prompt ?? "" };
    });
}

/** Loads a saved level by id. Ids are checked so they can't reach outside the folder. */
export function loadLevel(id: string, dir = LEVELS_DIR): Room | null {
  if (!ID.test(id)) return null;
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) return null;
  const room = JSON.parse(readFileSync(file, "utf8")) as Room;
  return validateRoom(room).length === 0 ? room : null;
}
