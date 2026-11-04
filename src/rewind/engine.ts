// Rewind: a world model that runs time backwards. From one photo of an aftermath (a crash, a broken
// vase, a fallen shelf), Muse Wonder finds the evidence, works out what probably happened before and
// why, with the physics, and ranks the possible explanations. Muse Image then paints the moments
// before in the same real place, going backwards from the photo, so you can watch it happen.
// Cases are saved in data/rewind/<id>/.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MetaClient, strictObject, type Schema } from "../ai/meta.ts";
import { config, ROOT } from "../config.ts";

export interface Evidence {
  label: string;
  x: number; // where it is in the photo, 0 (left) to 1 (right)
  y: number; // 0 (top) to 1 (bottom)
}

export interface Moment {
  secondsBefore: number;
  what: string; // what happens then
  picture: string; // what the same camera would have seen, for the painter
}

export interface Hypothesis {
  title: string;
  likelihood: number; // percent; all of them add up to 100
  physics: string;
  timeline: Moment[]; // earliest first
  supports: string[];
  against: string[];
  prevention: string;
}

export interface Investigation {
  scene: string;
  summary: string;
  evidence: Evidence[];
  hypotheses: Hypothesis[];
}

export type Painted = "waiting" | "painting" | "yes" | "failed";

export interface Case extends Investigation {
  id: string;
  context: string; // what the person told us
  thinkSeconds: number;
  painted: Painted[][]; // per hypothesis, per moment of its timeline
  made: string;
}

/** The thinking: the investigation, and a calmer rewrite of a picture the image filter refused. */
export interface Brain {
  investigate(photo: string, context: string): Promise<Investigation>;
  calm(picture: string): Promise<string>;
}

/** Paints a picture by changing another one. Throws if the safety filter refuses it. */
export interface Painter {
  paint(prompt: string, from: Buffer): Promise<Buffer>;
}

export const INVESTIGATE_INSTRUCTIONS = `You are an accident investigator and a physical world model. You get one photo of an aftermath, the moment just after something happened, and sometimes what the person knows. Work backwards in time: what happened just before, in what order, and why.

Reply with:
- scene: what the photo shows, in one sentence.
- evidence: 3 to 8 things in the photo that tell what happened: marks, damage and the direction it came from, where things ended up, how far debris spread, the surface, the weather and the light. label: under 12 words, saying what it shows, such as "curved tyre marks: braking while turning left". x and y: where it is in the photo, from 0 (left or top) to 1 (right or bottom).
- hypotheses: 2 to 4 different explanations, the most likely first, with likelihoods in percent that add up to 100. For each:
  - title: under 8 words;
  - physics: the direction of travel, estimated speeds, angles and forces, with numbers where the evidence allows, in 1 or 2 sentences;
  - timeline: 3 moments before the photo, earliest first. Pick times that fit the event, such as 10, 3 and 1 seconds before. what: what happens at that moment, in one sentence. picture: what the same camera, in the same place, would have seen at that moment, for a painter, in 2 sentences: the same place from the same viewpoint, with each thing where it was then. Show moments before any contact, never the contact itself, never injuries and never faces;
  - supports and against: the evidence for and against it, as short items;
  - prevention: what could have prevented it, in one sentence.
- summary: the most likely story, in 1 or 2 sentences.

Be honest: these are possibilities from what the photo shows, not certainties. Never blame or identify real people. In pictures, use only calm, neutral words, with no words of crashes, damage, injury or violence: describe positions, motion, light and weather.`;

const CALM_INSTRUCTIONS = `An image safety filter refused this description of a picture. Rewrite it so the filter accepts it: keep everything that can be seen, but use only calm, neutral words, with nothing about accidents, damage, danger or violence. Reply with the new picture.`;

const STRING: Schema = { type: "string" };
const LIST: Schema = { type: "array", items: STRING };
const NUMBER: Schema = { type: "number" };
const INVESTIGATION_SCHEMA = strictObject({
  scene: STRING,
  evidence: { type: "array", items: strictObject({ label: STRING, x: NUMBER, y: NUMBER }) },
  hypotheses: {
    type: "array",
    items: strictObject({
      title: STRING,
      likelihood: NUMBER,
      physics: STRING,
      timeline: { type: "array", items: strictObject({ secondsBefore: NUMBER, what: STRING, picture: STRING }) },
      supports: LIST,
      against: LIST,
      prevention: STRING,
    }),
  },
  summary: STRING,
});

export function createMetaBrain(client: MetaClient, models = { investigator: config.models.teacher, calm: config.models.engine }): Brain {
  return {
    investigate: (photo, context) =>
      client.json<Investigation>(models.investigator, INVESTIGATE_INSTRUCTIONS, { whatThePersonKnows: context || "nothing" }, "Investigation", INVESTIGATION_SCHEMA, "medium", {
        images: [photo],
        maxTokens: 10_000,
        timeoutMs: 240_000,
      }),
    async calm(picture) {
      const reply = await client.json<{ picture: string }>(models.calm, CALM_INSTRUCTIONS, { picture }, "Calm", strictObject({ picture: STRING }), "minimal", { maxTokens: 1500, timeoutMs: 30_000 });
      return reply.picture;
    },
  };
}

export function createMetaPainter(client: MetaClient, model = config.models.painter): Painter {
  return { paint: (prompt, from) => client.image(model, prompt, { from: [`data:image/jpeg;base64,${from.toString("base64")}`], strength: "low" }) };
}

/** Keeps the investigation within bounds: positions on the photo, likelihoods that add up to 100, moments in order. */
export function cleanInvestigation(raw: Investigation): Investigation {
  const unit = (value: number) => Math.min(1, Math.max(0, Number(value) || 0));
  const hypotheses = (raw.hypotheses ?? []).slice(0, 4).map((hypothesis) => ({
    ...hypothesis,
    likelihood: Math.max(0, Number(hypothesis.likelihood) || 0),
    timeline: (hypothesis.timeline ?? [])
      .filter((moment) => Number(moment.secondsBefore) > 0 && moment.picture)
      .sort((a, b) => b.secondsBefore - a.secondsBefore)
      .slice(0, 4),
    supports: (hypothesis.supports ?? []).slice(0, 6),
    against: (hypothesis.against ?? []).slice(0, 6),
  }));
  const total = hypotheses.reduce((sum, hypothesis) => sum + hypothesis.likelihood, 0);
  for (const hypothesis of hypotheses) hypothesis.likelihood = Math.round(total ? (hypothesis.likelihood / total) * 100 : 100 / hypotheses.length);
  hypotheses.sort((a, b) => b.likelihood - a.likelihood);
  return {
    scene: raw.scene ?? "",
    summary: raw.summary ?? "",
    evidence: (raw.evidence ?? []).slice(0, 8).map((item) => ({ label: item.label, x: unit(item.x), y: unit(item.y) })),
    hypotheses,
  };
}

export class RewindError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const REWIND_DIR = join(ROOT, "data", "rewind");
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** Runs investigations and paints their timelines, one moment after another, backwards from the photo. */
export class Rewind {
  readonly #brain: Brain;
  readonly #painter: Painter;
  readonly #spent: () => number;
  readonly #budgetUsd: number;
  readonly #dir: string;
  readonly #cases = new Map<string, Case>();
  readonly #frames = new Map<string, Promise<void>>(); // "id/h/n": done when that frame is painted

  constructor(brain: Brain, painter: Painter, { spent = (): number => 0, budgetUsd = config.paintBudgetUsd, dir = REWIND_DIR } = {}) {
    this.#brain = brain;
    this.#painter = painter;
    this.#spent = spent;
    this.#budgetUsd = budgetUsd;
    this.#dir = dir;
  }

  /** Investigates a photo, then starts painting the most likely explanation. */
  async start(photo: Buffer, context: string): Promise<Case> {
    this.#checkBudget();
    const started = performance.now();
    const found = cleanInvestigation(await this.#brain.investigate(`data:image/jpeg;base64,${photo.toString("base64")}`, context));
    if (found.hypotheses.length === 0) throw new RewindError(422, "The investigator couldn't find any explanation in this photo. Try a clearer photo of what happened.");
    const id = `case-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
    const record: Case = {
      ...found,
      id,
      context,
      thinkSeconds: Math.round((performance.now() - started) / 100) / 10,
      painted: found.hypotheses.map((hypothesis) => hypothesis.timeline.map((): Painted => "waiting")),
      made: new Date().toISOString(),
    };
    mkdirSync(join(this.#dir, id), { recursive: true });
    writeFileSync(join(this.#dir, id, "photo.jpg"), photo);
    this.#cases.set(id, record);
    this.#save(record);
    this.paint(id, 0);
    return record;
  }

  /**
   * Paints one explanation's moments: the closest to the photo first, each by changing the picture
   * just after it, so the scene stays the real place. Asking again for a painted explanation does nothing.
   */
  paint(id: string, h: number): Case {
    const record = this.get(id);
    if (!record) throw new RewindError(404, "No such case");
    const hypothesis = record.hypotheses[h];
    if (!hypothesis) throw new RewindError(404, "No such explanation");
    if (record.painted[h].some((state) => state !== "waiting")) return record;
    this.#checkBudget();
    let later: Promise<void> = Promise.resolve();
    for (let n = hypothesis.timeline.length - 1; n >= 0; n--) {
      record.painted[h][n] = "painting";
      const moment = hypothesis.timeline[n];
      const painting = later
        .then(() => this.#paintMoment(record, h, n, moment))
        .catch((error: Error) => {
          record.painted[h][n] = "failed";
          console.log(`[rewind] ${id} ${h}-${n}: ${error.message.slice(0, 200)}`);
        })
        .finally(() => {
          this.#frames.delete(`${id}/${h}/${n}`);
          this.#save(record);
        });
      this.#frames.set(`${id}/${h}/${n}`, painting);
      later = painting;
    }
    this.#save(record);
    return record;
  }

  get(id: string): Case | null {
    if (!ID.test(id)) return null;
    const known = this.#cases.get(id);
    if (known) return known;
    const file = join(this.#dir, id, "case.json");
    if (!existsSync(file)) return null;
    const record = JSON.parse(readFileSync(file, "utf8")) as Case;
    record.painted = record.painted.map((states) => states.map((state) => (state === "painting" ? "failed" : state))); // the server stopped while it painted
    this.#cases.set(id, record);
    return record;
  }

  photo(id: string): Buffer | null {
    const record = this.get(id);
    return record ? readFileSync(join(this.#dir, id, "photo.jpg")) : null;
  }

  /** A painted moment, waiting while it paints. A moment that failed shows the picture just after it. */
  async frame(id: string, h: number, n: number): Promise<Buffer | null> {
    const record = this.get(id);
    if (!record?.hypotheses[h]?.timeline[n]) return null;
    await this.#frames.get(`${id}/${h}/${n}`);
    return this.#readFrame(record, h, n);
  }

  async #paintMoment(record: Case, h: number, n: number, moment: Moment): Promise<void> {
    const from = this.#readFrame(record, h, n + 1);
    const prompt = (picture: string) =>
      `The same real place, photographed from exactly the same camera position and angle, ${moment.secondsBefore} seconds earlier. Keep the place, the light, the weather and every fixed object exactly the same. Anything made by what happened after this moment (tyre marks, dents, bends, spills, broken pieces, debris) is not there yet, so remove it. Show: ${picture}`;
    let jpeg: Buffer;
    try {
      jpeg = await this.#painter.paint(prompt(moment.picture), from);
    } catch (error) {
      if (!/content_policy/.test((error as Error).message)) throw error;
      jpeg = await this.#painter.paint(prompt(await this.#brain.calm(moment.picture)), from);
    }
    writeFileSync(this.#framePath(record, h, n), jpeg);
    record.painted[h][n] = "yes";
  }

  /** Moment n of an explanation, or the next later picture that exists, ending with the photo itself. */
  #readFrame(record: Case, h: number, n: number): Buffer {
    for (let k = n; k < record.hypotheses[h].timeline.length; k++) if (existsSync(this.#framePath(record, h, k))) return readFileSync(this.#framePath(record, h, k));
    return readFileSync(join(this.#dir, record.id, "photo.jpg"));
  }

  #framePath(record: Case, h: number, n: number): string {
    return join(this.#dir, record.id, `frame-${h}-${n}.jpg`);
  }

  #save(record: Case): void {
    mkdirSync(join(this.#dir, record.id), { recursive: true });
    writeFileSync(join(this.#dir, record.id, "case.json"), JSON.stringify(record, null, 2));
  }

  #checkBudget(): void {
    if (this.#spent() >= this.#budgetUsd) throw new RewindError(429, `Rewind has used its $${this.#budgetUsd.toFixed(2)} limit for this run of the server.`);
  }
}

/** What the page receives: the case, with links to the photo and every moment. */
export function publicCase(record: Case) {
  return {
    ...record,
    photo: `/api/rewind/${record.id}/photo.jpg`,
    hypotheses: record.hypotheses.map((hypothesis, h) => ({ ...hypothesis, frames: hypothesis.timeline.map((_, n) => `/api/rewind/${record.id}/${h}-${n}.jpg`), painted: record.painted[h] })),
  };
}

/** Rewind on Meta's models, or null without a key. */
export function createRewind(): Rewind | null {
  if (config.aiMode !== "meta" || !config.apiKey) return null;
  const client = new MetaClient(config.apiKey, config.baseUrl);
  return new Rewind(createMetaBrain(client), createMetaPainter(client), { spent: () => client.usage().usd });
}
