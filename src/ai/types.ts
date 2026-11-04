// The AI roles: four that run the game, and the designer that makes levels before a game.
// Each has an offline stand-in (offline.ts) and a Meta Model API version (meta.ts).
import type { GameDesign } from "../design/types.ts";
import type { Action, AgentId, ObjectId, Observation, Outcome, Room, RoundStatus, StepRecord, WorldState, ZoneId } from "../game/types.ts";

/** A rule in a notebook. Guard lessons are strategy; world lessons say how the real place works. */
export interface Lesson {
  id: string;
  kind: string; // e.g. "distraction", "darkness", "hiding", "forbid"
  text: string;
  round: number; // the round it was learned in
  target?: string; // the object or zone it is about
  action?: string; // for "forbid" lessons: the action that cannot happen
}

export type NewLesson = Omit<Lesson, "id" | "round">;

export type GuardTask =
  | { kind: "chase"; zone: ZoneId }
  | { kind: "investigate"; zone: ZoneId; looked: boolean }
  | { kind: "relight"; object: ObjectId }
  | { kind: "search"; object: ObjectId };

/** A guard's working memory during one round. */
export interface GuardMind {
  task: GuardTask | null;
  lastSeen: { zone: ZoneId; step: number } | null;
  plan: string;
  searched: ObjectId[];
  note: string | null; // why a guard holds its post this step, shown in the story
  leg: number; // for patrols: how many stops of the route the guard has reached
}

export interface GuardInput {
  state: WorldState; // brains may only use what the observations allow, never the thief's true position
  observations: Record<AgentId, Observation>;
  minds: Record<AgentId, GuardMind>;
  lessons: Lesson[];
}

export interface RoundReview {
  round: number;
  room: Room;
  status: RoundStatus;
  steps: StepRecord[];
  guardLessons: Lesson[];
  worldLessons: Lesson[];
}

export interface WorldMistake {
  step: number;
  problem: string;
  lesson: NewLesson;
}

/** Decides what happens when everyone acts at once. */
export interface WorldModel {
  resolve(state: WorldState, actions: Action[], worldLessons: Lesson[]): Promise<Outcome>;
}

/** Chooses the guards' actions from their observations and lessons. */
export interface GuardBrain {
  decide(input: GuardInput): Promise<Action[]>;
}

/** After a round, writes new strategy lessons for the guards. */
export interface Reflector {
  reflect(review: RoundReview): Promise<NewLesson[]>;
}

/** After a round, compares the world model's results with the real place and reports mistakes. */
export interface Teacher {
  review(review: RoundReview): Promise<WorldMistake[]>;
}

export interface DesignRequest {
  prompt: string; // the player's description of the game they want
  previous: GameDesign | null; // the last attempt, when it had problems
  problems: string[]; // what the checker found wrong with it
}

/** Before a game: turns the player's words into a level design. */
export interface Designer {
  model: string;
  design(request: DesignRequest): Promise<GameDesign>;
  usage(): UsageReport | null;
}

/** Before a game: turns the player's spoken idea into words. */
export interface Listener {
  model: string;
  transcribe(wav: Uint8Array): Promise<{ text: string; seconds: number }>;
  usage(): UsageReport | null;
}

export interface UsageReport {
  calls: number;
  usd: number;
  byModel: Record<string, { calls: number; inputTokens: number; cachedTokens: number; outputTokens: number; usd: number; audioSeconds?: number }>;
}

export interface AiSet {
  mode: "offline" | "meta";
  models: { world: string; guards: string; reflector: string; teacher: string };
  world: WorldModel;
  guards: GuardBrain;
  reflector: Reflector;
  teacher: Teacher;
  usage(): UsageReport | null;
  takeWarnings(): string[];
}
