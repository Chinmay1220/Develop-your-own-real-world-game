// Meta's AI inside a running game. A game the AI wrote declares what the world model may change
// ("can"), and asks it what happens while the player plays. Everything here arrives from a game we
// didn't write ourselves, so it is all checked before it reaches a model or a file.
import { strictObject, type Schema } from "../ai/meta.ts";

/** One input of a change: a number, a string, true or false, or one of a list of words. */
export type InputType = "number" | "string" | "boolean" | string[];

/** Something the world model (or a character's mind) may make happen in the game. */
export interface Change {
  does: string; // what it does, in the game's words
  with: Record<string, InputType>;
}

export type Can = Record<string, Change>;

/** A moment in the round, as the kit wrote it down. */
export interface Moment {
  t: number; // seconds since the round began
  who: string; // "player", "world", "game" or a character's name
  text: string;
}

/** The player (or the game) tries something; the world model decides what happens. */
export interface ActCall {
  kind: "act";
  game: string;
  by: "player" | "game";
  text: string;
  about: string;
  state: unknown;
  can: Can;
  recent: Moment[];
}

/** A character decides what to do next from what it can see. */
export interface ThinkCall {
  kind: "think";
  game: string;
  name: string;
  about: string;
  sees: unknown;
  can: Can;
  event: string;
  recent: Moment[];
}

/** The round is over: the teacher studies it and writes lessons for next time. */
export interface LearnCall {
  kind: "learn";
  game: string;
  about: string;
  result: "win" | "lose";
  message: string;
  state: unknown;
  minds: { name: string; about: string }[];
  history: Moment[];
}

export type LiveCall = ActCall | ThinkCall | LearnCall;

/** A change the model chose, ready for the game to run. */
export interface ChosenChange {
  name: string;
  input: Record<string, number | string | boolean>;
}

export const LIMITS = {
  changes: 12,
  inputs: 6,
  words: 30, // allowed words in one list
  minds: 4,
  about: 1500,
  text: 300,
  data: 6000, // state or sees, as JSON
  recent: 12,
  history: 60,
  moment: 400,
};

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const GAME = /^[a-z0-9][a-z0-9-]{0,59}$/;
// The reply's own keys; a change can't use these names.
const TAKEN = new Set(["story", "noticed", "thought", "say"]);

type Problem = string;
const text = (value: unknown, limit: number): string | null => (typeof value === "string" ? value.trim().slice(0, limit) : null);

/** Checks a call from a game. Returns the cleaned call, or what is wrong with it. */
export function readCall(body: unknown): LiveCall | Problem {
  if (!body || typeof body !== "object") return "Send a JSON object";
  const raw = body as Record<string, unknown>;
  if (typeof raw.game !== "string" || !GAME.test(raw.game)) return "game must be a game id";
  const about = text(raw.about, LIMITS.about);
  if (!about) return "about must say what the game is";

  if (raw.kind === "act") {
    const what = text(raw.text, LIMITS.text);
    if (!what) return "text must say what the player tries";
    const can = readCan(raw.can);
    if (typeof can === "string") return can;
    const state = readData(raw.state, "state");
    if (typeof state === "string") return state;
    return { kind: "act", game: raw.game, by: raw.by === "game" ? "game" : "player", text: what, about, state: state.value, can, recent: readMoments(raw.recent, LIMITS.recent) };
  }
  if (raw.kind === "think") {
    const name = text(raw.name, 40);
    if (!name) return "name must name the character";
    const can = readCan(raw.can);
    if (typeof can === "string") return can;
    const sees = readData(raw.sees, "sees");
    if (typeof sees === "string") return sees;
    return { kind: "think", game: raw.game, name, about, sees: sees.value, can, event: text(raw.event, LIMITS.text) ?? "", recent: readMoments(raw.recent, LIMITS.recent) };
  }
  if (raw.kind === "learn") {
    if (raw.result !== "win" && raw.result !== "lose") return 'result must be "win" or "lose"';
    const state = readData(raw.state, "state");
    if (typeof state === "string") return state;
    const minds = Array.isArray(raw.minds) ? raw.minds.slice(0, LIMITS.minds) : [];
    return {
      kind: "learn",
      game: raw.game,
      about,
      result: raw.result,
      message: text(raw.message, LIMITS.text) ?? "",
      state: state.value,
      minds: minds.flatMap((mind) => {
        const name = text((mind as Record<string, unknown>)?.name, 40);
        return name ? [{ name, about: text((mind as Record<string, unknown>).about, LIMITS.about) ?? "" }] : [];
      }),
      history: readMoments(raw.history, LIMITS.history),
    };
  }
  return 'kind must be "act", "think" or "learn"';
}

/** The changes a game offers. Problems are written for the game writer, who has to fix them. */
export function readCan(value: unknown): Can | Problem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "can must be an object of changes, such as { spawn: { does, with, run } }";
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "can needs at least one change";
  if (entries.length > LIMITS.changes) return `can has ${entries.length} changes; use at most ${LIMITS.changes}`;
  const can: Can = {};
  for (const [name, raw] of entries) {
    if (!NAME.test(name) || TAKEN.has(name)) return `"${name}" can't be a change name: use letters, digits and _, starting with a letter, and not story, noticed, thought or say`;
    const change = raw as Record<string, unknown> | null;
    const does = text(change?.does, 200);
    if (!does) return `change "${name}" needs does: a short description of what it does`;
    const inputs = Object.entries((change?.with ?? {}) as Record<string, unknown>);
    if (typeof change?.with !== "undefined" && (typeof change.with !== "object" || change.with === null || Array.isArray(change.with))) return `change "${name}": with must be an object such as { metres: "number" }`;
    if (inputs.length > LIMITS.inputs) return `change "${name}" has ${inputs.length} inputs; use at most ${LIMITS.inputs}`;
    const kinds: Record<string, InputType> = {};
    for (const [input, type] of inputs) {
      if (!NAME.test(input)) return `change "${name}": "${input}" can't be an input name`;
      if (type === "number" || type === "string" || type === "boolean") kinds[input] = type;
      else if (Array.isArray(type) && type.length > 0 && type.length <= LIMITS.words && type.every((word) => typeof word === "string" && word.length > 0 && word.length <= 40)) kinds[input] = [...new Set(type as string[])];
      else return `change "${name}": input "${input}" must be "number", "string", "boolean" or a list of 1 to ${LIMITS.words} words`;
    }
    can[name] = { does, with: kinds };
  }
  return can;
}

/** Plain data from the game (its state, or what a character sees), within the size limit. */
function readData(value: unknown, field: string): { value: unknown } | Problem {
  if (value === undefined) return { value: null };
  const json = JSON.stringify(value);
  if (json === undefined) return `${field} must be plain data`;
  if (json.length > LIMITS.data) return `${field} is ${json.length} characters as JSON; keep it under ${LIMITS.data}`;
  return { value: JSON.parse(json) };
}

function readMoments(value: unknown, limit: number): Moment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-limit).flatMap((moment) => {
    const raw = moment as Record<string, unknown>;
    const what = text(raw?.text, LIMITS.moment);
    return what ? [{ t: Math.round(Number(raw.t) || 0), who: text(raw.who, 40) || "game", text: what }] : [];
  });
}

/** The reply format: the fixed keys, then one list per change, so the model can only use what the game offers. */
export function replySchema(fixed: Record<string, Schema>, can: Can): Schema {
  const lists: Record<string, Schema> = {};
  for (const [name, change] of Object.entries(can)) {
    const inputs: Record<string, Schema> = {};
    for (const [input, type] of Object.entries(change.with)) inputs[input] = Array.isArray(type) ? { type: "string", enum: type } : { type };
    lists[name] = { type: "array", items: strictObject(inputs) };
  }
  return strictObject({ ...fixed, ...lists });
}

/** The changes in a reply, keeping only what the game offered, with inputs of the right kinds. */
export function chosenChanges(reply: Record<string, unknown>, can: Can, most = 8): ChosenChange[] {
  const chosen: ChosenChange[] = [];
  for (const [name, change] of Object.entries(can)) {
    const list = reply[name];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const input: ChosenChange["input"] = {};
      let fits = true;
      for (const [key, type] of Object.entries(change.with)) {
        const value = (item as Record<string, unknown>)?.[key];
        if (type === "number" && typeof value === "number" && Number.isFinite(value)) input[key] = value;
        else if (type === "boolean" && typeof value === "boolean") input[key] = value;
        else if (type === "string" && typeof value === "string") input[key] = value.slice(0, 200);
        else if (Array.isArray(type) && typeof value === "string" && type.includes(value)) input[key] = value;
        else fits = false;
      }
      if (fits) chosen.push({ name, input });
    }
  }
  return chosen.slice(0, most);
}

/** How a change reads in the history and the page's log: oil(metres=300). */
export function describeChange({ name, input }: ChosenChange): string {
  const values = Object.entries(input).map(([key, value]) => `${key}=${typeof value === "number" ? Number(value.toFixed(2)) : value}`);
  return `${name}(${values.join(", ")})`;
}
