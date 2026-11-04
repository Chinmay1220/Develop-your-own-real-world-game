// Meta's AI inside a running game: the world model decides what happens when the player tries
// anything, characters think for themselves, and after each round a teacher writes lessons so the
// world gets fairer and the characters get smarter. Games reach this through POST /api/live.
import { MetaClient, strictObject, type Schema } from "../ai/meta.ts";
import type { UsageReport } from "../ai/types.ts";
import { config } from "../config.ts";
import { forgetLessons, loadLessons, saveLessons, WORLDS_DIR, type GameLessons } from "./lessons.ts";
import { chosenChanges, replySchema, type ActCall, type ChosenChange, type LearnCall, type LiveCall, type ThinkCall } from "./rules.ts";

export const ACT_INSTRUCTIONS = `You are the world model of a video game that is being played right now. The game's code moves everything from moment to moment; you decide what happens when something comes up that the code can't decide by itself, most often when the player types or says anything they want to try.

Decide what really happens, like a fair and imaginative game master who knows how the real world works:
- Use the game's description (about), what is happening now (now) and what just happened (recent).
- It's a game, so say yes to creative ideas that fit this world, even unlikely ones, often with a cost or a catch. The changes on offer show what the game can do. Things that couldn't work at all here fail or backfire, with a reason.
- Cheating or skipping the challenge ("I win", "everyone vanishes", "give me a million points") doesn't work: the world reacts in a way that keeps the game fair and fun.
- Keep it in proportion: a small action has a small effect.
- Follow the lessons: rules about this world learned from earlier rounds.

Reply with:
- story: what happens, in one or two short sentences under 30 words. Speak to the player as "you".
- noticed: what the game's other characters could notice of it, in under 15 words, such as "a loud clatter from the east hall". Leave out the player's plan, and where the player is unless they could see it. "" if they would notice nothing.
- the changes: one list for each change the game offers. Changes are the only way anything happens in the game, so every event in your story needs its change, with sensible values for what is happening now. Never tell of an event that no change can make happen. Leave the other lists empty, and use at most 3 changes in all.`;

export const THINK_INSTRUCTIONS = `You are the mind of one character in a video game that is being played right now. The input says who you are (name and about), what you can see or know now (sees), what just happened (event and recent), and your lessons from earlier rounds against this player.

Choose what to do next from your plans: the change lists. Act as that character would: play to reach your goal, cleverly but fairly, using only what you can see. Your lessons say what beat you before and what worked, so use them. Don't keep a plan that is failing.

Reply with:
- thought: why you choose this, in under 15 words;
- say: a short line you say out loud, in character, under 10 words; or "" to stay quiet, which is best most of the time;
- your choice: exactly one item in one of the change lists. Leave the other lists empty.`;

export const LEARN_INSTRUCTIONS = `You coach the AI of a video game after a round. During the round, the world model decided what happened when the player tried things, and characters chose plans with minds of their own. Read the round's history and the lessons they already have, then write their lessons for the next round.

- world: up to 6 rules for the world model about how this world works. Fix decisions in the history that were unrealistic, unfair, too easy, too harsh or against the game's rules. Keep the good old rules. Each rule is one concrete sentence under 25 words.
- minds: for each character, up to 4 strategy lessons that will help it reach its goal against this player next round: what the player did that beat it, what worked, and what to do instead. Name the places, tricks and timing. Keep good old lessons and drop the ones that didn't help.
- summary: one sentence for the player about what the AI learned, under 25 words, for example "The rivals saw you always pass at the hairpin, so they will guard the inside line."
Write only what the history supports. If little happened, change little.`;

const STRING: Schema = { type: "string" };

export interface ActAnswer {
  story: string; // for the player
  noticed: string; // for the characters: only what they could see or hear
  changes: ChosenChange[];
}

export interface ThinkAnswer {
  thought: string;
  say: string;
  changes: ChosenChange[];
}

/** The three calls a running game can make. */
export interface LiveAi {
  models: { act: string; think: string; learn: string };
  act(call: ActCall, lessons: GameLessons): Promise<ActAnswer>;
  think(call: ThinkCall, lessons: GameLessons): Promise<ThinkAnswer>;
  learn(call: LearnCall, lessons: GameLessons): Promise<GameLessons>;
  usage(): UsageReport | null;
}

export function createMetaLive(client: MetaClient, models = { act: config.models.world, think: config.models.guards, learn: config.models.teacher }): LiveAi {
  return {
    models,
    async act(call, lessons) {
      const input = { about: call.about, lessons: lessons.world, now: call.state, recent: call.recent, [call.by === "game" ? "gameAsks" : "playerTries"]: call.text };
      const reply = await client.json<Record<string, unknown>>(models.act, ACT_INSTRUCTIONS, input, "WhatHappens", replySchema({ story: STRING, noticed: STRING }, call.can), "minimal", { maxTokens: 4000, timeoutMs: 45_000 });
      return { story: String(reply.story ?? "").slice(0, 300), noticed: String(reply.noticed ?? "").slice(0, 200), changes: chosenChanges(reply, call.can, 3) };
    },
    async think(call, lessons) {
      const input = { name: call.name, about: call.about, lessons: lessons.minds[call.name] ?? [], sees: call.sees, event: call.event, recent: call.recent };
      const reply = await client.json<Record<string, unknown>>(models.think, THINK_INSTRUCTIONS, input, "Choice", replySchema({ thought: STRING, say: STRING }, call.can), "minimal", { maxTokens: 3000, timeoutMs: 30_000 });
      return { thought: String(reply.thought ?? "").slice(0, 200), say: String(reply.say ?? "").slice(0, 120), changes: chosenChanges(reply, call.can, 1) };
    },
    async learn(call, lessons) {
      const names = call.minds.map((mind) => mind.name);
      const schema = strictObject({
        summary: STRING,
        world: { type: "array", items: STRING },
        minds: { type: "array", items: strictObject({ name: names.length ? { type: "string", enum: names } : STRING, lessons: { type: "array", items: STRING } }) },
      });
      const input = {
        about: call.about,
        result: `The player ${call.result === "win" ? "won" : "lost"}: ${call.message}`,
        characters: call.minds,
        lessons: { world: lessons.world, minds: lessons.minds },
        history: call.history,
        atTheEnd: call.state,
      };
      const reply = await client.json<{ summary: string; world: string[]; minds: { name: string; lessons: string[] }[] }>(models.learn, LEARN_INSTRUCTIONS, input, "Lessons", schema, "low", { maxTokens: 6000, timeoutMs: 120_000 });
      return mergeLessons(lessons, reply, names);
    },
    usage: () => client.usage(),
  };
}

/** The teacher's reply as the game's new lessons. Characters that weren't in this round keep theirs. */
export function mergeLessons(old: GameLessons, reply: { summary: string; world: string[]; minds: { name: string; lessons: string[] }[] }, names: string[]): GameLessons {
  const clean = (list: unknown, most: number) => (Array.isArray(list) ? list.filter((item) => typeof item === "string" && item.trim()).map((item: string) => item.trim().slice(0, 240)).slice(0, most) : []);
  const minds = { ...old.minds };
  for (const mind of reply.minds ?? []) if (names.includes(mind.name)) minds[mind.name] = clean(mind.lessons, 4);
  return { rounds: old.rounds + 1, summary: String(reply.summary ?? "").slice(0, 300), world: clean(reply.world, 6), minds };
}

export interface LiveReply {
  status: number;
  body: unknown;
}

/**
 * Answers calls from running games, within a spending limit and a rate limit. While a round is being
 * learned from, the next round's calls for that game wait for it, so the lessons apply at once.
 */
export class LiveGames {
  readonly ai: LiveAi | null;
  readonly #budgetUsd: number;
  readonly #perMinute: number;
  readonly #dir: string;
  readonly #learning = new Map<string, Promise<unknown>>();
  #recent: number[] = []; // when the last calls were made

  constructor(ai: LiveAi | null, { budgetUsd = config.liveBudgetUsd, perMinute = 40, dir = WORLDS_DIR } = {}) {
    this.ai = ai;
    this.#budgetUsd = budgetUsd;
    this.#perMinute = perMinute;
    this.#dir = dir;
  }

  lessons(game: string): GameLessons {
    return loadLessons(game, this.#dir);
  }

  forget(game: string): void {
    forgetLessons(game, this.#dir);
  }

  spent(): number {
    return this.ai?.usage()?.usd ?? 0;
  }

  async handle(call: LiveCall): Promise<LiveReply> {
    if (!this.ai) return { status: 503, body: { error: "Meta's AI in games needs a Meta API key in .env." } };
    if (this.spent() >= this.#budgetUsd) return { status: 429, body: { error: `The AI in games has used its $${this.#budgetUsd.toFixed(2)} limit for this run of the server.` } };
    const now = Date.now();
    this.#recent = this.#recent.filter((at) => now - at < 60_000);
    if (this.#recent.length >= this.#perMinute) return { status: 429, body: { error: "Too many AI calls this minute. The game keeps going without them for a moment." } };
    this.#recent.push(now);

    const ai = this.ai;
    const before = this.spent();
    const earlier = this.#learning.get(call.game)?.catch(() => {});
    if (call.kind !== "learn") {
      await earlier;
      const lessons = this.lessons(call.game);
      return this.#answer(call.kind === "act" ? await ai.act(call, lessons) : await ai.think(call, lessons), before);
    }
    // Registered before anything waits, so a question that arrives a moment later waits for these lessons.
    const learning = (async () => {
      await earlier;
      const learned = await ai.learn(call, this.lessons(call.game));
      saveLessons(call.game, learned, this.#dir);
      return learned;
    })();
    this.#learning.set(call.game, learning);
    try {
      return this.#answer(await learning, before);
    } finally {
      if (this.#learning.get(call.game) === learning) this.#learning.delete(call.game);
    }
  }

  #answer(result: object, before: number): LiveReply {
    return { status: 200, body: { ...result, usd: this.spent() - before } };
  }
}

export function createLive(): LiveGames {
  const ai = config.aiMode === "meta" && config.apiKey ? createMetaLive(new MetaClient(config.apiKey, config.baseUrl)) : null;
  return new LiveGames(ai);
}
