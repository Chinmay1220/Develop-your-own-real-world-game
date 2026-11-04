// No Engine: a game with no game code. Meta's AI is the whole engine.
// - The world model (Muse Spark) invents the world from the player's words, keeps all its facts, and
//   decides what happens on every move, other characters included.
// - The painter (Muse Image) draws every frame by changing the last one, so the world stays one place.
// - Between rounds, Muse Wonder writes what the characters remember about this player.
// Worlds and frames are saved in data/painted/<id>/.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MetaClient, strictObject, type Schema } from "../ai/meta.ts";
import { config, ROOT } from "../config.ts";

export type Status = "playing" | "won" | "lost";

export interface Character {
  name: string;
  about: string; // who they are and what they want
}

export interface Move {
  n: number; // its frame; 1 is the opening
  action: string; // what the player tried ("" for the opening)
  story: string;
  picture: string; // what the frame shows, as the world model told the painter
  thinkSeconds: number;
  paintSeconds: number | null;
  painted: "painting" | "yes" | "failed"; // failed: the frame repeats the last one
}

export interface World {
  id: string;
  prompt: string; // the player's words
  round: number;
  title: string;
  goal: string;
  look: string; // the visual style of every frame
  characters: Character[];
  facts: string[]; // everything that is true now: the whole state of the game
  remembered: string[]; // what the characters remember from earlier rounds
  learned: string; // what the last round taught them, for the player
  previousRound: string | null; // the world id of the round before, in the same place
  status: Status;
  moves: Move[];
  made: string;
}

/** The world model's opening of a new world. */
export interface Opening {
  title: string;
  goal: string;
  look: string;
  characters: Character[];
  facts: string[];
  story: string;
  picture: string;
}

/** For the next round: the world that must stay the same. */
export type SameWorld = Pick<World, "title" | "goal" | "look" | "characters">;

/** The world model's answer to one move. */
export interface Outcome {
  story: string;
  facts: string[];
  picture: string;
  status: Status;
}

/** The thinking: the world model, a rewrite for the image filter, and learning between rounds. */
export interface Brain {
  imagine(prompt: string, remembered: string[], sameWorld: SameWorld | null): Promise<Opening>;
  decide(world: World, action: string): Promise<Outcome>;
  calm(picture: string): Promise<string>;
  learn(world: World): Promise<{ summary: string; remembered: string[] }>;
}

/** The painting: from words alone, or by changing the last frame. Throws on a blocked picture. */
export interface Painter {
  paint(prompt: string, last: Buffer | null): Promise<Buffer>;
}

const PICTURE_RULES = `Describe pictures only by what can be seen, in calm, neutral words, the way a film director briefs a painter. Call the player character by how they look (for example "the hooded figure" or "the red race car"). Never use words of crime or violence, such as thief, steal, weapon, gun, attack, hit, kill, blood or hurt: show danger through light, posture and distance instead.`;

export const IMAGINE_INSTRUCTIONS = `You are the game engine of a video game that has no game code. A player describes a game in their own words, often spoken, so it can be messy. You invent its world and keep it running: you hold all its facts and decide what happens, and a painter draws each moment from your description.

Make the world the player asked for, with their characters, setting, mood and goal. Fill in the rest to make it exciting, with a clear goal that takes about 6 to 15 moves.

Reply with:
- title: 2 to 5 words; use the player's name for the game if they gave one;
- goal: how the player wins and how they can lose, in one sentence;
- look: the visual style of every picture, in one sentence. Unless the player asks for another style, use: "A screenshot from a realistic modern 3D video game (Unreal Engine 5 quality): cinematic third-person camera a few metres behind and above the player character, real lighting and materials, sharp detail, no text, no interface." Fit the camera to the game, for example behind the car in a race;
- characters: the other characters who act in this world, 0 to 4, each with a name and about: one sentence on who they are and what they want;
- facts: the facts of the world at the start, 5 to 10 short sentences: the place, where everyone and everything is, and what each character is doing;
- story: the opening, in 1 or 2 short sentences, speaking to the player as "you";
- picture: the first picture for the painter, in 2 or 3 sentences: what the camera sees.

If the input has remembered, the characters remember those things from earlier rounds against this player. Let it show in the facts: for example a guard now watches the place where the player hid last time.

If the input has sameWorld, this is the next round of that world: keep its title, goal, look, place and characters exactly, and start again from the beginning. Only what the characters remember changes where they are and what they do.

${PICTURE_RULES}`;

export const DECIDE_INSTRUCTIONS = `You are the game engine of a video game that has no game code: you keep all the facts of the world and decide what happens, and a painter draws each moment from your description.

Each move you get the game, the facts so far, the last moves and what the player tries now. Decide what really happens, fairly, the way the real world works:
- The other characters act at the same time. Each has a mind of its own and acts only on what it can see and hear. They react to noises and changes, and remember what happened this round and what they remember from earlier rounds.
- It's a game: say yes to creative ideas that could work here, often with a cost or a catch. Things that couldn't work fail or backfire. Cheating ("I win now") doesn't work.
- Keep the world consistent: nothing appears, vanishes or moves without a reason.
- Keep it moving: something should happen every move, and the round ends, won or lost, within about 6 to 15 moves.

Reply with:
- story: what happens, in 1 or 2 short sentences, speaking to the player as "you";
- facts: the complete, updated facts of the world, 5 to 10 short sentences;
- picture: the next picture for the painter, in 2 or 3 sentences: what the camera sees and exactly what changed since the last picture. Show the other characters whenever they are in view;
- status: "playing", "won" or "lost".

${PICTURE_RULES}`;

const CALM_INSTRUCTIONS = `An image safety filter refused this description of a video game picture. Rewrite it so the filter accepts it: keep everything that can be seen, but use only calm, neutral words, with nothing about crime, violence or danger. Reply with the new picture.`;

export const LEARN_INSTRUCTIONS = `A round of a video game has just ended. Read what the player did and what happened, and write what the game's other characters will remember the next time they face this player.
- remembered: up to 5 short sentences. Each names a trick, habit or route this player used and how the characters will counter it next time. Keep what they remembered before if it still matters.
- summary: one sentence for the player, under 25 words, such as "The guards remember your shoe trick: next time, one of them will stay by the statue."`;

const STRING: Schema = { type: "string" };
const LIST: Schema = { type: "array", items: STRING };
const STATUS: Schema = { type: "string", enum: ["playing", "won", "lost"] };

export function createMetaBrain(client: MetaClient, models = { engine: config.models.engine, teacher: config.models.teacher }): Brain {
  return {
    async imagine(prompt, remembered, sameWorld) {
      const schema = strictObject({ title: STRING, goal: STRING, look: STRING, characters: { type: "array", items: strictObject({ name: STRING, about: STRING }) }, facts: LIST, story: STRING, picture: STRING });
      const input = { request: prompt, remembered, ...(sameWorld ? { sameWorld } : {}) };
      return client.json<Opening>(models.engine, IMAGINE_INSTRUCTIONS, input, "Opening", schema, "low", { maxTokens: 4000, timeoutMs: 60_000 });
    },
    async decide(world, action) {
      const input = {
        game: { title: world.title, goal: world.goal, characters: world.characters, remembered: world.remembered },
        factsSoFar: world.facts,
        lastMoves: world.moves.slice(-6).map((move) => ({ playerTried: move.action || "(the game began)", happened: move.story })),
        playerTries: action,
      };
      const schema = strictObject({ story: STRING, facts: LIST, picture: STRING, status: STATUS });
      return client.json<Outcome>(models.engine, DECIDE_INSTRUCTIONS, input, "Outcome", schema, "low", { maxTokens: 4000, timeoutMs: 60_000 });
    },
    async calm(picture) {
      const reply = await client.json<{ picture: string }>(models.engine, CALM_INSTRUCTIONS, { picture }, "Calm", strictObject({ picture: STRING }), "minimal", { maxTokens: 1500, timeoutMs: 30_000 });
      return reply.picture;
    },
    async learn(world) {
      const input = { game: { title: world.title, goal: world.goal, characters: world.characters }, result: world.status, rememberedBefore: world.remembered, moves: world.moves.map((move) => ({ playerTried: move.action || "(the game began)", happened: move.story })) };
      return client.json<{ summary: string; remembered: string[] }>(models.teacher, LEARN_INSTRUCTIONS, input, "Remembered", strictObject({ summary: STRING, remembered: LIST }), "low", { maxTokens: 4000, timeoutMs: 90_000 });
    },
  };
}

export function createMetaPainter(client: MetaClient, model = config.models.painter): Painter {
  return {
    // The opening is painted with more care (about 17 s); each move changes the last frame (about 10 s).
    paint: (prompt, last) => client.image(model, prompt, last ? { from: [`data:image/jpeg;base64,${last.toString("base64")}`], strength: "low" } : { strength: "high" }),
  };
}

export class EngineError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const PAINTED_DIR = join(ROOT, "data", "painted");
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** Runs painted worlds: one move at a time per world, frames painted in order, within a spending limit. */
export class NoEngine {
  readonly #brain: Brain;
  readonly #painter: Painter;
  readonly #spent: () => number;
  readonly #budgetUsd: number;
  readonly #dir: string;
  readonly #worlds = new Map<string, World>();
  readonly #painting = new Map<string, Promise<void>>(); // per world: the last frame queued, so frames paint in order
  readonly #frames = new Map<string, Promise<void>>(); // per frame ("id/n"): done when it is painted
  readonly #busy = new Set<string>();

  constructor(brain: Brain, painter: Painter, { spent = (): number => 0, budgetUsd = config.paintBudgetUsd, dir = PAINTED_DIR } = {}) {
    this.#brain = brain;
    this.#painter = painter;
    this.#spent = spent;
    this.#budgetUsd = budgetUsd;
    this.#dir = dir;
  }

  /** A new world from the player's words. It returns once the world model has spoken; the first frame paints after. */
  async start(prompt: string, { remembered = [] as string[], round = 1, learned = "", previous = null as World | null } = {}): Promise<World> {
    this.#checkBudget();
    const started = performance.now();
    // A next round keeps the same world; only the characters' memories change it.
    const same: SameWorld | null = previous && { title: previous.title, goal: previous.goal, look: previous.look, characters: previous.characters };
    const opening = { ...(await this.#brain.imagine(prompt, remembered, same)), ...same };
    const world: World = {
      id: `${slug(opening.title)}-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`,
      prompt,
      round,
      title: opening.title,
      goal: opening.goal,
      look: opening.look,
      characters: opening.characters.slice(0, 4),
      facts: opening.facts,
      remembered,
      learned,
      previousRound: previous?.id ?? null,
      status: "playing",
      moves: [],
      made: new Date().toISOString(),
    };
    this.#worlds.set(world.id, world);
    this.#addMove(world, "", { story: opening.story, picture: opening.picture }, performance.now() - started);
    return world;
  }

  /** The player tries something: the world model decides, then the painter draws it. */
  async act(id: string, action: string): Promise<World> {
    const world = this.get(id);
    if (!world) throw new EngineError(404, "No such world");
    if (world.status !== "playing") throw new EngineError(409, `This round is over: you ${world.status}. Play again for the next round.`);
    if (this.#busy.has(id)) throw new EngineError(409, "The world is still deciding your last move.");
    this.#checkBudget();
    this.#busy.add(id);
    try {
      const started = performance.now();
      const outcome = await this.#brain.decide(world, action);
      world.facts = outcome.facts;
      world.status = outcome.status;
      this.#addMove(world, action, outcome, performance.now() - started);
      return world;
    } finally {
      this.#busy.delete(id);
    }
  }

  /** The next round of a finished world: the characters remember what this player did. */
  async again(id: string): Promise<World> {
    const world = this.get(id);
    if (!world) throw new EngineError(404, "No such world");
    if (world.status === "playing") throw new EngineError(409, "Finish this round first.");
    this.#checkBudget();
    const { summary, remembered } = await this.#brain.learn(world);
    return this.start(world.prompt, { remembered: remembered.slice(0, 5), round: world.round + 1, learned: summary, previous: world });
  }

  get(id: string): World | null {
    if (!ID.test(id)) return null;
    const known = this.#worlds.get(id);
    if (known) return known;
    const file = join(this.#dir, id, "world.json");
    if (!existsSync(file)) return null;
    const world = JSON.parse(readFileSync(file, "utf8")) as World;
    for (const move of world.moves) if (move.painted === "painting") move.painted = "failed"; // the server stopped while it painted
    this.#worlds.set(id, world);
    return world;
  }

  /** A frame as a JPEG, waiting while it is painted. Null if there is no such frame. */
  async frame(id: string, n: number): Promise<Buffer | null> {
    const world = this.get(id);
    if (!world || !world.moves.some((move) => move.n === n)) return null;
    await this.#frames.get(`${id}/${n}`);
    return this.#readFrame(world, n);
  }

  #addMove(world: World, action: string, { story, picture }: { story: string; picture: string }, thinkMs: number): void {
    const move: Move = { n: world.moves.length + 1, action, story, picture, thinkSeconds: round1(thinkMs / 1000), paintSeconds: null, painted: "painting" };
    world.moves.push(move);
    this.#save(world);
    // Frames paint one after another: each one changes the frame before it.
    // A new round's opening is painted from the last round's frames, so it waits for them too.
    const before = this.#painting.get(world.id) ?? (world.previousRound ? this.#painting.get(world.previousRound) : undefined) ?? Promise.resolve();
    const painting = before
      .then(() => this.#paint(world, move))
      .catch((error: Error) => {
        // Never let a failed frame stop the server, or the frames after it.
        move.painted = "failed";
        console.log(`[paint] ${world.id} frame ${move.n}: ${error.message.slice(0, 200)}`);
      })
      .finally(() => this.#frames.delete(`${world.id}/${move.n}`));
    this.#painting.set(world.id, painting);
    this.#frames.set(`${world.id}/${move.n}`, painting);
  }

  async #paint(world: World, move: Move): Promise<void> {
    const started = performance.now();
    // Each frame changes the one before. A new round's opening changes the last round's opening, so it is the same place.
    const before = move.n === 1 && world.previousRound ? this.get(world.previousRound) : null;
    const last = move.n > 1 ? this.#readFrame(world, move.n - 1) : before ? this.#readFrame(before, 1) : null;
    const prompt = (picture: string) =>
      !last ? `${world.look} ${picture}`
      : move.n === 1 ? `The same place at the start of a new round of the same video game, with the same style and camera. Keep the place, the lighting and how every character looks, and show: ${picture}`
      : `The next moment of the same video game, in the same place, with the same style and camera. Keep every object, character and the lighting consistent with the picture, and change only what this describes: ${picture}`;
    let jpeg: Buffer | null = null;
    try {
      jpeg = await this.#painter.paint(prompt(move.picture), last);
    } catch (error) {
      // The image filter sometimes refuses harmless game words: ask for calmer ones and try once more.
      if (/content_policy/.test((error as Error).message)) {
        try {
          jpeg = await this.#painter.paint(prompt(await this.#brain.calm(move.picture)), last);
        } catch (again) {
          console.log(`[paint] ${world.id} frame ${move.n} failed twice: ${(again as Error).message.slice(0, 200)}`);
        }
      } else console.log(`[paint] ${world.id} frame ${move.n} failed: ${(error as Error).message.slice(0, 200)}`);
    }
    if (jpeg) writeFileSync(this.#framePath(world, move.n), jpeg);
    move.painted = jpeg ? "yes" : "failed";
    move.paintSeconds = round1((performance.now() - started) / 1000);
    this.#save(world);
  }

  /** The frame's picture, or the last one painted before it when it failed. */
  #readFrame(world: World, n: number): Buffer | null {
    for (let k = n; k >= 1; k--) if (existsSync(this.#framePath(world, k))) return readFileSync(this.#framePath(world, k));
    return null;
  }

  #framePath(world: World, n: number): string {
    return join(this.#dir, world.id, `frame-${n}.jpg`);
  }

  #save(world: World): void {
    mkdirSync(join(this.#dir, world.id), { recursive: true });
    writeFileSync(join(this.#dir, world.id, "world.json"), JSON.stringify(world, null, 2));
  }

  #checkBudget(): void {
    if (this.#spent() >= this.#budgetUsd) throw new EngineError(429, `No Engine has used its $${this.#budgetUsd.toFixed(2)} limit for this run of the server.`);
  }
}

/** What the page receives: the world, with a link to each frame. */
export function publicWorld(world: World) {
  return { ...world, moves: world.moves.map((move) => ({ ...move, image: `/api/paint/${world.id}/${move.n}.jpg` })) };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "world"
  );
}

/** No Engine on Meta's models, or null without a key. */
export function createNoEngine(): NoEngine | null {
  if (config.aiMode !== "meta" || !config.apiKey) return null;
  const client = new MetaClient(config.apiKey, config.baseUrl);
  return new NoEngine(createMetaBrain(client), createMetaPainter(client), { spent: () => client.usage().usd });
}
