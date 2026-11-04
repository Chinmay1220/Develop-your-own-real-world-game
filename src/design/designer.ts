// Turns a player's words into a playable level. The designer AI writes a design, code checks it,
// and any problems go back to the designer to fix.
import type { Designer } from "../ai/types.ts";
import { validateRoom } from "../game/room.ts";
import type { Room } from "../game/types.ts";
import { buildRoom } from "./build.ts";
import { checkDesign } from "./check.ts";
import type { GameDesign } from "./types.ts";

export interface DesignResult {
  room: Room;
  design: GameDesign;
  attempts: string[][]; // the problems found in each attempt; the last one is empty
}

export class DesignError extends Error {
  readonly attempts: string[][];
  constructor(attempts: string[][]) {
    super(`The designer could not make a playable level in ${attempts.length} tries. Last problems:\n- ${attempts.at(-1)!.join("\n- ")}`);
    this.attempts = attempts;
  }
}

export async function designLevel(prompt: string, designer: Designer, maxAttempts = 3): Promise<DesignResult> {
  const attempts: string[][] = [];
  let previous: GameDesign | null = null;
  let problems: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const design = await designer.design({ prompt, previous, problems });
    problems = checkDesign(design);
    if (problems.length === 0) {
      const room = buildRoom(design, prompt);
      problems = validateRoom(room); // a last check in the engine's own terms
      if (problems.length === 0) return { room, design, attempts: [...attempts, []] };
    }
    attempts.push(problems);
    previous = design;
  }
  throw new DesignError(attempts);
}
