// Everything the guards and the world model remember between rounds, saved as one JSON file per room.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Lesson, NewLesson } from "../ai/types.ts";
import type { RoundStatus } from "../game/types.ts";

export interface RoundSummary {
  round: number;
  status: RoundStatus;
  steps: number;
  blockedChanges: number; // impossible changes the checker stopped
  worldMistakes: number; // mistakes the teacher found
  newGuardLessons: number;
}

export interface Notebook {
  guardLessons: Lesson[];
  worldLessons: Lesson[];
  history: RoundSummary[];
}

export function emptyNotebook(): Notebook {
  return { guardLessons: [], worldLessons: [], history: [] };
}

export function loadNotebook(path: string): Notebook {
  if (!existsSync(path)) return emptyNotebook();
  return { ...emptyNotebook(), ...(JSON.parse(readFileSync(path, "utf8")) as Partial<Notebook>) };
}

export function saveNotebook(path: string, notebook: Notebook): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(notebook, null, 2));
}

/** Adds the lessons that are not already known and returns them. Lessons about a target match by kind and target. */
export function addLessons(list: Lesson[], incoming: NewLesson[], round: number, idPrefix: string): Lesson[] {
  const added: Lesson[] = [];
  for (const lesson of incoming) {
    const known = list.some(
      (existing) =>
        existing.kind === lesson.kind &&
        (existing.target ?? "") === (lesson.target ?? "") &&
        (existing.action ?? "") === (lesson.action ?? "") &&
        (lesson.target !== undefined || lesson.kind !== "other" || existing.text === lesson.text),
    );
    if (known) continue;
    const full: Lesson = { ...lesson, id: `${idPrefix}${list.length + 1}`, round };
    list.push(full);
    added.push(full);
  }
  return added;
}
