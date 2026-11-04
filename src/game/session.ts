// One player's game: the current round, the guards' working memory, and the notebook kept between rounds.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AiSet, GuardMind, Lesson, RoundReview, WorldMistake } from "../ai/types.ts";
import { addLessons, saveNotebook, type Notebook } from "../memory/notebook.ts";
import { resolveStep } from "./engine.ts";
import { observe } from "./perception.ts";
import type { Action, AgentId, Observation, Room, RoundStatus, StepRecord, WorldState } from "./types.ts";
import { createState, describeAction, getGuards, getThief } from "./world.ts";

export interface RoundReport {
  round: number;
  status: RoundStatus;
  steps: number;
  newGuardLessons: Lesson[];
  newWorldLessons: Lesson[];
  mistakes: WorldMistake[];
  warnings: string[];
}

export type PlayerAction = Omit<Action, "actor" | "text"> & { text?: string };

export interface SessionOptions {
  notebookPath?: string; // where to save the notebook; nothing is saved without it
  logDir?: string; // where to save a full log of each finished round
}

export class Session {
  readonly room: Room;
  readonly ai: AiSet;
  readonly notebook: Notebook;
  readonly options: SessionOptions;
  round: number;
  state: WorldState;
  steps: StepRecord[] = [];
  lastReport: RoundReport | null = null;
  #observations: Record<AgentId, Observation> = {};
  #minds: Record<AgentId, GuardMind> = {};
  #pendingGuards: Promise<Action[]> = Promise.resolve([]);
  #busy = false;

  constructor(room: Room, ai: AiSet, notebook: Notebook, options: SessionOptions = {}) {
    this.room = room;
    this.ai = ai;
    this.notebook = notebook;
    this.options = options;
    this.round = notebook.history.at(-1)?.round ?? 0;
    this.state = createState(room);
    this.startRound();
  }

  /** Starts the next round, or restarts the current one if it never finished. */
  startRound(): void {
    if (this.round === 0 || this.notebook.history.some((row) => row.round === this.round)) this.round += 1;
    this.state = createState(this.room);
    this.steps = [];
    this.lastReport = null;
    this.#minds = Object.fromEntries(getGuards(this.state).map((guard) => [guard.id, { task: null, lastSeen: null, plan: "", searched: [], note: null, leg: 0 }]));
    this.#observations = observe(this.state, this.state, []);
    this.#prepareGuards();
  }

  /** Resolves once the guards have chosen their next actions. */
  async guardsReady(): Promise<void> {
    await this.#pendingGuards.catch(() => {});
  }

  /**
   * The guards' next actions depend only on what they noticed so far, not on the player's next move,
   * so they are worked out while the player is still deciding.
   */
  #prepareGuards(): void {
    const pending = this.ai.guards.decide({
      state: this.state,
      observations: this.#observations,
      minds: this.#minds,
      lessons: this.notebook.guardLessons,
    });
    pending.catch(() => {}); // a failure surfaces when act() awaits it
    this.#pendingGuards = pending;
  }

  /** Plays one step: the guards' prepared actions and the player's go to the world model, then the engine applies the hard rules. */
  async act(input: PlayerAction): Promise<{ record: StepRecord; report: RoundReport | null }> {
    if (this.state.status !== "playing") throw new Error("This round is over. Start the next round.");
    if (this.#busy) throw new Error("Still working on the last step.");
    this.#busy = true;
    try {
      const thief = getThief(this.state);
      const action: Action = { ...input, actor: thief.id, text: input.text?.trim() || describeAction(this.state, { ...input, actor: thief.id }) };
      const actions = [action, ...(await this.#pendingGuards)];
      const outcome = await this.ai.world.resolve(this.state, actions, this.notebook.worldLessons);
      const { state, record, observations } = resolveStep(this.state, actions, outcome);
      record.events.push(...this.ai.takeWarnings());

      this.state = state;
      this.#observations = observations;
      this.steps.push(record);
      for (const [guardId, seen] of Object.entries(observations)) {
        if (seen.thiefSeenAt) this.#minds[guardId].lastSeen = { zone: seen.thiefSeenAt, step: state.step };
      }
      if (state.status === "playing") this.#prepareGuards();
      const report = state.status === "playing" ? null : await this.#finishRound();
      return { record, report };
    } finally {
      this.#busy = false;
    }
  }

  /** Forgets every lesson and starts again from round 1. */
  resetMemory(): void {
    this.notebook.guardLessons.length = 0;
    this.notebook.worldLessons.length = 0;
    this.notebook.history.length = 0;
    this.round = 0;
    this.startRound();
    if (this.options.notebookPath) saveNotebook(this.options.notebookPath, this.notebook);
  }

  /** After a round: the guards reflect on it, the teacher checks the world model, and both notebooks grow. */
  async #finishRound(): Promise<RoundReport> {
    const review: RoundReview = {
      round: this.round,
      room: this.room,
      status: this.state.status,
      steps: this.steps,
      guardLessons: this.notebook.guardLessons,
      worldLessons: this.notebook.worldLessons,
    };
    const [lessons, mistakes] = await Promise.all([this.ai.reflector.reflect(review), this.ai.teacher.review(review)]);
    const newGuardLessons = addLessons(this.notebook.guardLessons, lessons, this.round, "G");
    const newWorldLessons = addLessons(
      this.notebook.worldLessons,
      mistakes.map((mistake) => mistake.lesson),
      this.round,
      "W",
    );
    this.notebook.history.push({
      round: this.round,
      status: this.state.status,
      steps: this.state.step,
      blockedChanges: this.steps.reduce((total, step) => total + step.rejected.length, 0),
      worldMistakes: mistakes.length,
      newGuardLessons: newGuardLessons.length,
    });
    this.lastReport = {
      round: this.round,
      status: this.state.status,
      steps: this.state.step,
      newGuardLessons,
      newWorldLessons,
      mistakes,
      warnings: this.ai.takeWarnings(),
    };

    if (this.options.notebookPath) saveNotebook(this.options.notebookPath, this.notebook);
    if (this.options.logDir) {
      mkdirSync(this.options.logDir, { recursive: true });
      const file = join(this.options.logDir, `${this.room.id}-round-${this.round}-${Date.now()}.json`);
      writeFileSync(file, JSON.stringify({ report: this.lastReport, steps: this.steps }, null, 2));
    }
    return this.lastReport;
  }
}
