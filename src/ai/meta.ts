// Meta Model API versions of the four AI roles, written from dev.meta.ai/docs
// (Chat Completions with strict JSON-schema replies).
import { AUDIO_PRICES, IMAGE_PRICES, PRICES } from "../config.ts";
import { CATALOG, FORBIDDABLE, KINDS, LOOKS, MAX_PARTS, OUTDOOR_STYLES, SHAPES, STYLES } from "../design/catalog.ts";
import type { GameDesign } from "../design/types.ts";
import type { Action, ActionKind, Change, Loudness, Noise, Outcome, WorldState } from "../game/types.ts";
import { describeAction, getGuards, isLit } from "../game/world.ts";
import type { AiSet, Designer, GuardInput, Lesson, Listener, NewLesson, RoundReview, UsageReport, WorldMistake } from "./types.ts";

type Effort = "minimal" | "low" | "medium" | "high";
export type Schema = Record<string, unknown>;

/** Limits for one call. Most replies are short; designing a level needs more room and time. */
interface CallLimits {
  maxTokens?: number;
  timeoutMs?: number;
  images?: string[]; // data URLs of pictures to look at, sent with the input
}

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

export class MetaClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #usage: UsageReport = { calls: 0, usd: 0, byModel: {} };

  constructor(apiKey: string, baseUrl: string) {
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /** One Chat Completions call whose reply must match the JSON schema. */
  async json<T>(
    model: string,
    instructions: string,
    input: unknown,
    schemaName: string,
    schema: Schema,
    effort: Effort,
    { maxTokens = 4000, timeoutMs = 90_000, images = [] }: CallLimits = {},
  ): Promise<T> {
    const text = JSON.stringify(input);
    const message = images.length ? [{ type: "text", text }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] : text;
    const body = {
      model,
      messages: [
        { role: "developer", content: instructions },
        { role: "user", content: message },
      ],
      reasoning_effort: effort,
      max_completion_tokens: maxTokens,
      // Strict mode constrains the key names too. Without it the model sometimes garbled them.
      response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
    };
    const response = (await this.#request("/chat/completions", body, timeoutMs)) as ChatResponse;
    this.#track(model, response);
    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${model} sent an empty reply`);
    return JSON.parse(content) as T;
  }

  /** Speech to text (POST /v1/asr/transcribe): a WAV clip of mono 16-bit PCM at 16 or 24 kHz in, the words out. */
  async transcribe(model: string, wav: Uint8Array): Promise<{ text: string; seconds: number }> {
    const form = new FormData();
    form.append("request", new Blob([JSON.stringify({ model, audioEncoding: "WAV", mode: "PUSH_TO_TALK" })], { type: "application/json" }));
    form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "speech.wav");
    const response = (await this.#request("/asr/transcribe", form, 60_000)) as { transcript?: string; audioDurationMs?: number };
    const seconds = (response.audioDurationMs ?? 0) / 1000;
    this.#trackAudio(model, seconds);
    return { text: (response.transcript ?? "").trim(), seconds };
  }

  /**
   * Paints a picture with Muse Image: from words alone (POST /v1/images/generations), or by changing
   * earlier pictures (POST /v1/images/edits, with JPEG data URLs). Returns the JPEG.
   * A picture the safety filter blocks throws an error whose message says content_policy.
   */
  async image(model: string, prompt: string, { from = [] as string[], size = "1792x1024", strength = "low" as "low" | "high", timeoutMs = 180_000 } = {}): Promise<Buffer> {
    const body = {
      model,
      prompt,
      n: 1,
      size,
      output_format: "jpeg",
      reasoning_strength: strength,
      // No web or image search: a game frame needs nothing from outside, and it is faster without.
      tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
      ...(from.length ? { images: from.map((url) => ({ image_url: url })) } : {}),
    };
    const response = (await this.#request(from.length ? "/images/edits" : "/images/generations", body, timeoutMs)) as { data?: { b64_json?: string }[] };
    const picture = response.data?.[0]?.b64_json;
    if (!picture) throw new Error(`${model} sent no picture`);
    const entry = (this.#usage.byModel[model] ??= { calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0 });
    entry.calls += 1;
    entry.usd += IMAGE_PRICES[model] ?? 0;
    this.#usage.calls += 1;
    this.#usage.usd += IMAGE_PRICES[model] ?? 0;
    return Buffer.from(picture, "base64");
  }

  async listModels(): Promise<string[]> {
    const response = (await this.#request("/models")) as { data?: { id: string }[] };
    return (response.data ?? []).map((model) => model.id);
  }

  usage(): UsageReport {
    return structuredClone(this.#usage);
  }

  /** Sends JSON, or a form with files (fetch then sets the content type itself). */
  async #request(path: string, body?: unknown, timeoutMs = 90_000, attempt = 1): Promise<unknown> {
    const form = body instanceof FormData;
    const response = await fetch(`${this.#baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${this.#apiKey}`, ...(form ? { Accept: "application/json" } : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise((done) => setTimeout(done, 1500 * attempt));
      return this.#request(path, body, timeoutMs, attempt + 1);
    }
    if (!response.ok) throw new Error(`Meta API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return response.json();
  }

  #track(model: string, response: ChatResponse): void {
    const input = response.usage?.prompt_tokens ?? 0;
    const cached = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const output = response.usage?.completion_tokens ?? 0;
    const price = PRICES[model];
    const usd = price ? ((input - cached) * price.input + cached * price.cached + output * price.output) / 1_000_000 : 0;
    const entry = (this.#usage.byModel[model] ??= { calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0 });
    entry.calls += 1;
    entry.inputTokens += input;
    entry.cachedTokens += cached;
    entry.outputTokens += output;
    entry.usd += usd;
    this.#usage.calls += 1;
    this.#usage.usd += usd;
  }

  #trackAudio(model: string, seconds: number): void {
    const usd = (Math.floor(seconds) / 3600) * (AUDIO_PRICES[model] ?? 0);
    const entry = (this.#usage.byModel[model] ??= { calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0, audioSeconds: 0 });
    entry.calls += 1;
    entry.audioSeconds = (entry.audioSeconds ?? 0) + seconds;
    entry.usd += usd;
    this.#usage.calls += 1;
    this.#usage.usd += usd;
  }
}

// ---------------------------------------------------------------------------
// Instructions and reply formats

const WORLD_INSTRUCTIONS = `You are the world model of Home Heist, a turn-based stealth game set in a real place.
All characters act at the same time in each step. Decide what really happens, like a fair game master who knows how real rooms and objects behave. Things that would not work in the real place fail.

Reply with:
- narration: one short line per action, in the order given, under 20 words each. Address the thief as "you" and call guards by name. Skip lines for guards who only wait.
- the state changes, each kind in its own list, using only ids from the input:
  moves {actor, to}: to a neighboring zone. Moving out of a hiding spot is allowed.
  hides {actor, object}: into an object with free hideCapacity in the same zone.
  unhides {actor}
  pickUps {actor, object}: a portable object in the same zone.
  places {object, zone}: a thrown or dropped object lands, at most 3 zones away.
  sets {object, key, value}: key is "on" or "broken".
- noises: sounds others could hear, with loudness 1 (heard 1 zone away), 2 or 3.
Leave a list empty when nothing of that kind happens.

Every action that succeeds needs its change. A successful move, for example, needs an entry in moves.
Code checks every change and blocks impossible ones. Code also settles guard searches, catches and escapes, so only narrate those.
worldLessons are corrections from a teacher who compared your earlier answers with the real place. Always follow them.`;

const GUARD_INSTRUCTIONS = `You control the guards in Home Heist, a turn-based stealth game. The guards protect a target object and the exits from a thief.
Each guard knows only its own observation: what it can see, what it heard, and what it remembers. Never assume the thief's position beyond that.
Choose one action per guard:
- move: target is a neighboring zone id
- search: target is the id of a hiding spot object in the guard's zone
- use: target is the id of a switchable object in the guard's zone, for example to turn a light back on
- wait (use "" as the target)
Each guard has a duty: "target" guards protect the target, "exit" guards watch an exit, and "patrol" guards walk the zones in their route, in a loop.
Act like ordinary guards: go after a thief you can see, and go and check noises you hear.
The lessons were written by these guards after rounds the thief won. When a lesson applies, follow it, even if it goes against those habits.
Write a short plan for each guard. You will see it again next step.`;

const REFLECT_INSTRUCTIONS = `You coach the guards in Home Heist. Read the round log and write at most 2 new lessons that will help the guards next time.
Focus on the thief's tricks that worked. Each lesson must be a concrete rule the guards can follow. Do not repeat existing lessons.
Set target to the id of the object or zone the lesson is about, or "" if none. Return an empty list if there is nothing new to learn.`;

const TEACHER_INSTRUCTIONS = `You check the world model of Home Heist against the real place. The facts come from the real place and are always true.
Go through the steps and find results that could not happen there: hiding where there is no space, seeing through walls or furniture, objects behaving unrealistically.
For each mistake give the step number, what went wrong, a general lesson for the world model, the id of the object or zone it is about (or ""), and the action it concerns, such as "hide" (or "").
Only report real mistakes. Return an empty list if there are none.`;

const catalogLines = KINDS.map((kind) => `- ${kind}: ${CATALOG[kind].what}${CATALOG[kind].portable ? " (can be carried and thrown)" : ""}`);
const listing = (record: Record<string, string>) => Object.entries(record).map(([key, text]) => `${key} (${text})`).join(", ");

const DESIGN_INSTRUCTIONS = `You design levels for a 3D stealth game. A player describes, in their own words, the game they want. You turn it into a level the game can build and play.

Every level shares one core: the player must reach the target object, take it, and leave through an exit without being caught. Hunters catch the player by entering the player's room while the player is not hiding. They can be people or creatures, such as guards, ghosts, spiders or dogs. The player can sneak, hide, throw things to make noise, and switch lights off. Fit the player's idea into this core.

Keep what the player asked for: their place, their characters, their things and their mood. Never rename unrelated furniture to fake something: a sofa is not a root, and lockers do not belong in a tree. If nothing in the catalog looks like a thing they asked for, choose the kind that plays the right way and draw its look in parts.
- note: one or two sentences on how you fitted their idea into the game, such as the goal you added.
- missing: each thing they asked for that you could not show or do, in a few words. If they ask for something this game cannot do, such as racing or shooting, make the closest stealth version and list it here. Use [] if nothing is missing.

The place is a grid of square cells, 4 columns by 4 rows, each 6 metres wide. A room covers width × depth cells (1 or 2 each), starting at column col and row row, counted from 0. Rooms must not overlap.
- Use 3 to 7 rooms. Name each with a short phrase starting with "the", such as "the main gallery", and describe it in one sentence.
- A connection joins two rooms that share a wall. A "doorway" is an open arch that hunters can see through; a "door" blocks the view. Every room must be reachable from the player's start room.
- At least one room on the outside of the place has an exit. Set exit to its name, such as "the back door" or "the roof hatch"; other rooms use "".
- Outdoor styles (${OUTDOOR_STYLES.join(", ")}) have no walls. Each room is an open area of ground, such as "the old oak" or "the meadow", edged by hedges. Connections are paths: a "doorway" is an open path, and a "door" is a gap in thick hedges. Use an outdoor style for places in nature.

Objects: 8 to 24, each of a kind from the catalog below. Give each an id (lowercase letters, digits and underscores), a name of 1 to 3 words without "the", its room, and notes for the world model about how it looks and behaves.
- parts is [] to use the catalog's look. To draw a thing the catalog has no look for, give up to ${MAX_PARTS} simple shapes. Each has a shape (${SHAPES.join(", ")}), a centre x, y, z in metres from the middle of the thing's footprint (y is the height above the ground), a size w, h, d in metres, and a colour as #rrggbb. Keep it about the size of its kind.
- The target must be a kind that can be carried. Put it at least two rooms away from the player's start, and protect it.
- The player may start holding 1 or 2 small things to throw: set their room to "".
- For each light, list in lights the rooms it lights ([] means its own room). A room that no light reaches is always lit, so add lights where darkness should be a trick.
- Give the player choices along the way: hiding spots, things to throw, and lights to switch off.
- Furniture must fit: at most 5 pieces in a 1-cell room, 9 in a 2-cell room and 17 in a 4-cell room. Small things that can be carried do not count.

The player and the hunters: look is how they appear, a person or a creature from the looks below. color is a creature's main colour as #rrggbb, or "" to keep the look's own colours.
Hunters: 1 to 4. duty is "target" (stays near the target), "exit" (watches an exit) or "patrol" (walks the rooms in route in a loop; at least 2 rooms). post is the room they return to; route is [] unless they patrol. No hunter may start in the player's start room or see into it through a doorway.

facts: 2 to 5 things that are always true in this place, which the world model must respect, such as "The display case is made of armoured glass and cannot be broken." Set object to the id it is about ("" if none) and forbids to the action it rules out ("" if none).

story: 2 or 3 sentences, spoken to the player as "you", shown before the game starts. title: 2 to 5 words. style: the look of the place. maxSteps: 20 to 40.

If the input includes a previous design and its problems, that design broke these rules. Return the whole design again with every problem fixed, changing as little else as possible.

Catalog:
${catalogLines.join("\n")}

Looks: ${listing(LOOKS)}.
Styles: ${listing(STYLES)}.`;

/** An object in strict mode: every key is required and no other keys are allowed. */
export function strictObject(properties: Record<string, Schema>): Schema {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const STRING: Schema = { type: "string" };
const listOf = (item: Schema): Schema => ({ type: "array", items: item });

const OUTCOME_SCHEMA = strictObject({
  narration: listOf(STRING),
  moves: listOf(strictObject({ actor: STRING, to: STRING })),
  hides: listOf(strictObject({ actor: STRING, object: STRING })),
  unhides: listOf(strictObject({ actor: STRING })),
  pickUps: listOf(strictObject({ actor: STRING, object: STRING })),
  places: listOf(strictObject({ object: STRING, zone: STRING })),
  sets: listOf(strictObject({ object: STRING, key: { type: "string", enum: ["on", "broken"] }, value: { type: "boolean" } })),
  noises: listOf(strictObject({ zone: STRING, loudness: { type: "integer", enum: [1, 2, 3] }, what: STRING })),
});

const GUARD_SCHEMA = strictObject({
  actions: listOf(strictObject({ guard: STRING, kind: { type: "string", enum: ["move", "search", "use", "wait"] }, target: STRING, plan: STRING })),
});

const LESSONS_SCHEMA = strictObject({
  lessons: listOf(strictObject({ kind: { type: "string", enum: ["distraction", "darkness", "hiding", "route", "other"] }, text: STRING, target: STRING })),
});

const MISTAKES_SCHEMA = strictObject({
  mistakes: listOf(strictObject({ step: { type: "integer" }, problem: STRING, lesson: STRING, target: STRING, action: STRING })),
});

const oneOf = (values: string[]): Schema => ({ type: "string", enum: values });
const CELLS: Schema = { type: "integer", enum: [0, 1, 2, 3] };
const SPAN: Schema = { type: "integer", enum: [1, 2] };

const NUMBER: Schema = { type: "number" };
const PART = strictObject({ shape: oneOf(SHAPES), x: NUMBER, y: NUMBER, z: NUMBER, w: NUMBER, h: NUMBER, d: NUMBER, color: STRING });

const DESIGN_SCHEMA = strictObject({
  title: STRING,
  story: STRING,
  note: STRING,
  missing: listOf(STRING),
  style: oneOf(Object.keys(STYLES)),
  rooms: listOf(strictObject({ id: STRING, name: STRING, description: STRING, col: CELLS, row: CELLS, width: SPAN, depth: SPAN, exit: STRING })),
  connections: listOf(strictObject({ from: STRING, to: STRING, kind: oneOf(["doorway", "door"]) })),
  objects: listOf(strictObject({ id: STRING, name: STRING, kind: oneOf(KINDS), room: STRING, notes: STRING, lights: listOf(STRING), parts: listOf(PART) })),
  target: STRING,
  player: strictObject({ look: oneOf(Object.keys(LOOKS)), color: STRING, room: STRING }),
  hunters: listOf(
    strictObject({
      id: STRING,
      name: STRING,
      look: oneOf(Object.keys(LOOKS)),
      color: STRING,
      room: STRING,
      duty: oneOf(["target", "exit", "patrol"]),
      post: STRING,
      route: listOf(STRING),
    }),
  ),
  facts: listOf(strictObject({ text: STRING, object: STRING, forbids: oneOf(["", ...FORBIDDABLE]) })),
  maxSteps: { type: "integer" },
});

// ---------------------------------------------------------------------------
// What each role sees

function layout(state: WorldState) {
  return Object.values(state.zones).map(({ id, name, neighbors, sees, exit }) => ({ id, name, neighbors, sees, exit: Boolean(exit) }));
}

function worldInput(state: WorldState, actions: Action[], worldLessons: Lesson[]) {
  return {
    room: { name: state.roomName, description: state.description },
    zones: layout(state).map((zone) => ({ ...zone, lit: isLit(state, zone.id) })),
    objects: Object.values(state.objects),
    characters: Object.values(state.agents).map(({ id, name, role, zone, hiddenIn }) => ({ id, name, role, zone, hiddenIn })),
    worldLessons: worldLessons.map((lesson) => lesson.text),
    actions: actions.map(({ actor, kind, target, item, text }) => ({ actor, kind, target, item, text })),
  };
}

/** Only what the guards could know: no thief position beyond their own observations. */
function guardInput({ state, observations, minds, lessons }: GuardInput) {
  const target = state.objects[state.targetId];
  return {
    step: state.step,
    maxSteps: state.maxSteps,
    zones: layout(state),
    target: { id: target.id, name: target.name, where: target.heldBy ? "missing" : target.zone },
    objects: Object.values(state.objects)
      .filter((object) => object.zone !== null)
      .map(({ id, name, zone, hideCapacity, switchable, on }) => ({ id, name, zone, hideCapacity, switchable, on })),
    guards: getGuards(state).map((guard) => ({
      id: guard.id,
      name: guard.name,
      zone: guard.zone,
      post: guard.post,
      duty: guard.duty,
      route: guard.route ?? [],
      observation: observations[guard.id],
      lastSeenThief: minds[guard.id].lastSeen,
      plan: minds[guard.id].plan,
    })),
    lessons: lessons.map((lesson) => lesson.text),
  };
}

function reviewInput(review: RoundReview) {
  return {
    round: review.round,
    result: review.status,
    room: { name: review.room.name, description: review.room.description },
    steps: review.steps.map((step) => ({
      step: step.step,
      actions: step.actions.map((action) => `${action.actor}: ${action.text}`),
      story: [...step.narration, ...step.events],
      changes: step.accepted,
    })),
  };
}

// ---------------------------------------------------------------------------
// Turning replies into game data. Anything unreadable is reported to the checker, which also
// blocks anything impossible.

type RawItems = Record<string, unknown>[] | undefined;

interface RawOutcome {
  narration?: unknown[];
  moves?: RawItems;
  hides?: RawItems;
  unhides?: RawItems;
  pickUps?: RawItems;
  places?: RawItems;
  sets?: RawItems;
  noises?: RawItems;
}

function toOutcome(raw: RawOutcome): Outcome {
  const changes: Change[] = [];
  const unreadable: string[] = [];
  // The checker reads changes in this order: leave hiding, move, pick up, land, hide, switch or break.
  const groups: [Change["op"], RawItems][] = [
    ["unhide", raw.unhides],
    ["move", raw.moves],
    ["pickUp", raw.pickUps],
    ["place", raw.places],
    ["hide", raw.hides],
    ["set", raw.sets],
  ];
  for (const [op, items] of groups) {
    for (const item of items ?? []) {
      const change = toChange({ ...item, op });
      if (change) changes.push(change);
      else unreadable.push(JSON.stringify({ op, ...item }).slice(0, 200));
    }
  }
  const noises: Noise[] = (raw.noises ?? [])
    .filter((noise) => typeof noise.zone === "string" && (noise.loudness === 1 || noise.loudness === 2 || noise.loudness === 3))
    .map((noise) => ({ zone: noise.zone as string, loudness: noise.loudness as Loudness, what: String(noise.what ?? "a noise") }));
  return { changes, noises, narration: (raw.narration ?? []).map(String), unreadable };
}

/** Accepts the zone under either "to" or "zone", since the model mixes them up; anything else unclear is unreadable. */
function toChange(raw: Record<string, unknown>): Change | null {
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : undefined);
  const actor = text("actor");
  const object = text("object");
  const to = text("to") ?? text("zone");
  const zone = text("zone") ?? text("to");
  switch (raw.op) {
    case "move":
      return actor && to ? { op: "move", actor, to } : null;
    case "hide":
      return actor && object ? { op: "hide", actor, object } : null;
    case "unhide":
      return actor ? { op: "unhide", actor } : null;
    case "pickUp":
      return actor && object ? { op: "pickUp", actor, object } : null;
    case "place":
      return object && zone ? { op: "place", object, zone } : null;
    case "set":
      return object && (raw.key === "on" || raw.key === "broken") && typeof raw.value === "boolean"
        ? { op: "set", object, key: raw.key, value: raw.value }
        : null;
    default:
      return null;
  }
}

const GUARD_KINDS = new Set<string>(["move", "search", "use", "wait"]);

export function createMetaAi(client: MetaClient, models: AiSet["models"]): AiSet {
  return {
    mode: "meta",
    models,
    world: {
      async resolve(state, actions, worldLessons) {
        const raw = await client.json<RawOutcome>(models.world, WORLD_INSTRUCTIONS, worldInput(state, actions, worldLessons), "StepOutcome", OUTCOME_SCHEMA, "low");
        return toOutcome(raw);
      },
    },
    guards: {
      async decide(input) {
        type Reply = { actions?: { guard?: string; kind?: string; target?: string; plan?: string }[] };
        const reply = await client.json<Reply>(models.guards, GUARD_INSTRUCTIONS, guardInput(input), "GuardActions", GUARD_SCHEMA, "low");
        return getGuards(input.state).map((guard): Action => {
          const choice = reply.actions?.find((action) => action.guard === guard.id);
          const kind = (choice?.kind && GUARD_KINDS.has(choice.kind) ? choice.kind : "wait") as ActionKind;
          const target = kind === "wait" ? undefined : choice?.target || undefined;
          input.minds[guard.id].plan = choice?.plan ?? "";
          return { actor: guard.id, kind, target, text: describeAction(input.state, { actor: guard.id, kind, target }) };
        });
      },
    },
    reflector: {
      async reflect(review) {
        type Reply = { lessons?: { kind?: string; text?: string; target?: string }[] };
        const input = { ...reviewInput(review), existingLessons: review.guardLessons.map((lesson) => lesson.text) };
        const reply = await client.json<Reply>(models.reflector, REFLECT_INSTRUCTIONS, input, "GuardLessons", LESSONS_SCHEMA, "medium");
        return (reply.lessons ?? [])
          .filter((lesson) => lesson.text)
          .slice(0, 2)
          .map((lesson): NewLesson => ({ kind: lesson.kind || "other", text: lesson.text!, target: lesson.target || undefined }));
      },
    },
    teacher: {
      async review(review) {
        type Reply = { mistakes?: { step?: number; problem?: string; lesson?: string; target?: string; action?: string }[] };
        const input = {
          facts: review.room.facts.map((fact) => fact.text),
          objects: review.room.objects.map(({ id, name, notes }) => ({ id, name, notes })),
          ...reviewInput(review),
          knownLessons: review.worldLessons.map((lesson) => lesson.text),
        };
        const reply = await client.json<Reply>(models.teacher, TEACHER_INSTRUCTIONS, input, "WorldMistakes", MISTAKES_SCHEMA, "medium");
        return (reply.mistakes ?? [])
          .filter((mistake) => mistake.lesson)
          .map(
            (mistake): WorldMistake => ({
              step: Number(mistake.step) || 0,
              problem: mistake.problem ?? "",
              lesson: {
                kind: mistake.action ? "forbid" : "world",
                text: mistake.lesson!,
                target: mistake.target || undefined,
                action: mistake.action || undefined,
              },
            }),
          );
      },
    },
    usage: () => client.usage(),
    takeWarnings: () => [],
  };
}

export function createMetaListener(client: MetaClient, model: string): Listener {
  return { model, transcribe: (wav) => client.transcribe(model, wav), usage: () => client.usage() };
}

/** Designing a whole level takes more thinking and a longer reply than one game step. */
export function createMetaDesigner(client: MetaClient, model: string): Designer {
  return {
    model,
    async design({ prompt, previous, problems }) {
      const input = previous ? { request: prompt, previousDesign: previous, problems } : { request: prompt };
      return client.json<GameDesign>(model, DESIGN_INSTRUCTIONS, input, "LevelDesign", DESIGN_SCHEMA, "medium", { maxTokens: 16_000, timeoutMs: 240_000 });
    },
    usage: () => client.usage(),
  };
}
