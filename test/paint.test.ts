import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NoEngine, type Brain, type Outcome, type Painter } from "../src/paint/engine.ts";

/** A stand-in world model: the round is won on the third move. Pictures are text, so the tests can read them. */
function fakes({ blocked = [] as string[] } = {}) {
  const painted: { prompt: string; last: string | null }[] = [];
  let moves = 0;
  const brain: Brain = {
    async imagine(prompt, remembered) {
      return { title: "Test Heist", goal: "Take the statue.", look: "LOOK.", characters: [{ name: "Vera", about: "a guard" }], facts: [`start: ${prompt}`, ...remembered], story: "You arrive.", picture: "the hall" };
    },
    async decide(_world, action): Promise<Outcome> {
      moves += 1;
      return { story: `You ${action}.`, facts: [`after ${action}`], picture: action, status: moves >= 3 ? "won" : "playing" };
    },
    async calm(picture) {
      return `calm ${picture}`;
    },
    async learn(world) {
      return { summary: "They remember your noise trick.", remembered: [`counter: ${world.moves.at(-1)!.action}`] };
    },
  };
  const painter: Painter = {
    async paint(prompt, last) {
      await new Promise((done) => setTimeout(done, 5));
      if (blocked.some((word) => prompt.includes(word) && !prompt.includes(`calm ${word}`))) throw new Error('Meta API 400: {"error":{"code":"content_policy_violation"}}');
      if (prompt.includes("never")) throw new Error("Meta API 500: down");
      painted.push({ prompt, last: last?.toString() ?? null });
      return Buffer.from(`frame for: ${prompt.slice(-30)}`);
    },
  };
  return { brain, painter, painted };
}

function withDir(run: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "painted-"));
    try {
      await run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test(
  "a world starts from words, and each frame is painted from the one before it",
  withDir(async (dir) => {
    const { brain, painter, painted } = fakes();
    const engine = new NoEngine(brain, painter, { dir });
    const world = await engine.start("a museum heist");
    assert.equal(world.moves[0].painted, "painting");
    assert.match((await engine.frame(world.id, 1))!.toString(), /the hall/);
    assert.equal(painted[0].prompt, "LOOK. the hall"); // the opening uses the look
    assert.equal(painted[0].last, null);

    await engine.act(world.id, "hide behind the pillar");
    await engine.act(world.id, "throw a shoe"); // asked before frame 2 is painted: it still waits its turn
    assert.match((await engine.frame(world.id, 3))!.toString(), /throw a shoe/);
    assert.match(painted[1].last!, /the hall/);
    assert.match(painted[2].last!, /hide behind the pillar/);
    assert.deepEqual(engine.get(world.id)!.facts, ["after throw a shoe"]);
    assert.equal(await engine.frame(world.id, 9), null);
  }),
);

test(
  "a picture the image filter refuses is painted again in calmer words, and a frame that fails keeps the last one",
  withDir(async (dir) => {
    const { brain, painter, painted } = fakes({ blocked: ["grab"] });
    const engine = new NoEngine(brain, painter, { dir });
    const world = await engine.start("a heist");
    await engine.act(world.id, "grab");
    assert.match((await engine.frame(world.id, 2))!.toString(), /calm grab/);
    assert.equal(engine.get(world.id)!.moves[1].painted, "yes");

    await engine.act(world.id, "never");
    assert.match((await engine.frame(world.id, 3))!.toString(), /calm grab/); // the last painted frame
    assert.equal(engine.get(world.id)!.moves[2].painted, "failed");
    assert.equal(painted.length, 2);
  }),
);

test(
  "one move at a time, no moves after the round ends, and the next round remembers the player",
  withDir(async (dir) => {
    const { brain, painter, painted } = fakes();
    const engine = new NoEngine(brain, painter, { dir });
    const world = await engine.start("a heist");
    const first = engine.act(world.id, "sneak");
    await assert.rejects(engine.act(world.id, "run"), /still deciding/);
    await first;
    await engine.act(world.id, "make a noise");
    const won = await engine.act(world.id, "take the statue");
    assert.equal(won.status, "won");
    await assert.rejects(engine.act(world.id, "dance"), /round is over/);

    const next = await engine.again(world.id);
    assert.equal(next.round, 2);
    assert.deepEqual(next.remembered, ["counter: take the statue"]);
    assert.equal(next.learned, "They remember your noise trick.");
    assert.ok(next.facts.includes("counter: take the statue"));
    await assert.rejects(engine.again(next.id), /Finish this round/);
    await Promise.all([engine.frame(world.id, 4), engine.frame(next.id, 1)]);
    // The next round is the same place: its opening is painted from the last round's opening.
    assert.equal(next.previousRound, world.id);
    const opening = painted.find((picture) => /start of a new round/.test(picture.prompt));
    assert.equal(opening?.last, "frame for: LOOK. the hall");
  }),
);

test(
  "worlds are saved and can be played on later, and the spending limit stops new moves",
  withDir(async (dir) => {
    const { brain, painter } = fakes();
    let spent = 0;
    const engine = new NoEngine(brain, painter, { dir, spent: () => spent, budgetUsd: 1 });
    const world = await engine.start("a heist");
    await engine.frame(world.id, 1);
    const later = new NoEngine(brain, painter, { dir });
    assert.equal(later.get(world.id)!.title, "Test Heist");
    assert.equal(later.get("../../etc"), null);
    spent = 1;
    await assert.rejects(engine.act(world.id, "sneak"), /limit/);
  }),
);
