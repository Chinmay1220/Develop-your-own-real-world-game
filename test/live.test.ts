import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { emptyLessons, type GameLessons } from "../src/live/lessons.ts";
import { LiveGames, mergeLessons, type LiveAi } from "../src/live/live.ts";
import { chosenChanges, describeChange, readCall, readCan, replySchema, type ActCall, type Can, type LearnCall } from "../src/live/rules.ts";

const CAN = {
  oil: { does: "spill oil on the track", with: { metres: "number" } },
  spin: { does: "make a car spin", with: { car: ["red", "blue"] } },
  rain: { does: "start or stop rain", with: { on: "boolean" } },
  boost: { does: "a burst of speed" },
};
const ACT = { kind: "act", game: "f1-test", about: "An F1 race.", text: "pour oil behind me", can: CAN, state: { lap: 1 } };

test("a game's call is checked and cleaned", () => {
  const call = readCall({ ...ACT, recent: [{ t: 3.7, who: "player", text: "tried: brake" }, { nonsense: true }] }) as ActCall;
  assert.equal(call.kind, "act");
  assert.equal(call.by, "player");
  assert.deepEqual(call.can.boost, { does: "a burst of speed", with: {} });
  assert.deepEqual(call.recent, [{ t: 4, who: "player", text: "tried: brake" }]);
  assert.equal(readCall({ ...ACT, game: "../secrets" }), "game must be a game id");
  assert.match(readCall({ ...ACT, text: "" }) as string, /text/);
  assert.match(readCall({ ...ACT, state: { big: "x".repeat(7000) } }) as string, /keep it under/);
  assert.match(readCall({ ...ACT, kind: "hack" }) as string, /kind must be/);
});

test("the changes a game offers must be well formed, and the problems say how to fix them", () => {
  assert.match(readCan({}) as string, /at least one/);
  assert.match(readCan({ story: { does: "x" } }) as string, /can't be a change name/);
  assert.match(readCan({ "bad name": { does: "x" } }) as string, /can't be a change name/);
  assert.match(readCan({ oil: {} }) as string, /needs does/);
  assert.match(readCan({ oil: { does: "x", with: { metres: "float" } } }) as string, /must be "number"/);
  assert.match(readCan({ oil: { does: "x", with: { car: [] } } }) as string, /list of 1 to/);
  const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`c${i}`, { does: "x" }]));
  assert.match(readCan(many) as string, /at most 12/);
});

test("the reply format has one list per change, with every key required", () => {
  const can = readCan(CAN) as Can;
  const schema = replySchema({ story: { type: "string" } }, can) as { required: string[]; properties: Record<string, any> };
  assert.deepEqual(schema.required, ["story", "oil", "spin", "rain", "boost"]);
  assert.deepEqual(schema.properties.spin.items.properties.car, { type: "string", enum: ["red", "blue"] });
  assert.equal(schema.properties.boost.items.additionalProperties, false);
});

test("only offered changes with the right kinds of input are passed on", () => {
  const can = readCan(CAN) as Can;
  const reply = { story: "…", oil: [{ metres: 300 }, { metres: "far" }], spin: [{ car: "green" }, { car: "blue" }], rain: [], boost: [{}], hack: [{ all: true }] };
  const chosen = chosenChanges(reply, can);
  assert.deepEqual(chosen.map(describeChange), ["oil(metres=300)", "spin(car=blue)", "boost()"]);
  assert.equal(chosenChanges(reply, can, 1).length, 1);
});

test("the teacher's lessons replace the old ones for characters in the round, and keep the rest", () => {
  const old: GameLessons = { rounds: 2, summary: "", world: ["old rule"], minds: { Fox: ["old tip"], Owl: ["owl tip"] } };
  const merged = mergeLessons(old, { summary: "The fox flanks now.", world: ["rule 1", "", "rule 2"], minds: [{ name: "Fox", lessons: ["flank", "feint"] }, { name: "Stranger", lessons: ["x"] }] }, ["Fox"]);
  assert.deepEqual(merged, { rounds: 3, summary: "The fox flanks now.", world: ["rule 1", "rule 2"], minds: { Fox: ["flank", "feint"], Owl: ["owl tip"] } });
});

/** A stand-in for Meta's AI that costs a cent per call and learns a fixed lesson. */
function fakeAi(): LiveAi & { seen: GameLessons[] } {
  let usd = 0;
  const seen: GameLessons[] = [];
  const spend = () => (usd += 0.01);
  return {
    models: { act: "fake", think: "fake", learn: "fake" },
    seen,
    async act(_call, lessons) {
      spend();
      seen.push(lessons);
      return { story: "Oil spreads behind you.", noticed: "an oil slick on the track", changes: [{ name: "oil", input: { metres: 300 } }] };
    },
    async think() {
      spend();
      return { thought: "block", say: "", changes: [] };
    },
    async learn(call, lessons) {
      spend();
      await new Promise((done) => setTimeout(done, 50));
      return mergeLessons(lessons, { summary: "learned", world: ["oil is slippery"], minds: [] }, call.minds.map((mind) => mind.name));
    },
    usage: () => ({ calls: 0, usd, byModel: {} }),
  };
}

test("games get answers within the budget and the rate limit, and the next round waits for learning", async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-"));
  try {
    const ai = fakeAi();
    const live = new LiveGames(ai, { budgetUsd: 0.025, perMinute: 10, dir }); // the third call spends past it
    const act = readCall(ACT) as ActCall;
    const first = await live.handle(act);
    assert.equal(first.status, 200);
    assert.equal((first.body as { story: string }).story, "Oil spreads behind you.");

    // Learning runs while the next round's first question arrives: that question waits and gets the lessons.
    const learn = readCall({ kind: "learn", game: "f1-test", about: "An F1 race.", result: "win", message: "You won", history: [{ t: 1, who: "player", text: "tried oil" }] }) as LearnCall;
    const learning = live.handle(learn);
    const next = await live.handle(act);
    assert.equal(next.status, 200);
    assert.deepEqual(ai.seen.at(-1)?.world, ["oil is slippery"]);
    assert.equal((await learning).status, 200);
    assert.equal(live.lessons("f1-test").rounds, 1);

    const broke = await live.handle(act);
    assert.equal(broke.status, 429);
    assert.match((broke.body as { error: string }).error, /limit/);

    live.forget("f1-test");
    assert.deepEqual(live.lessons("f1-test"), emptyLessons());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without a key, games are told the AI is off", async () => {
  const live = new LiveGames(null);
  assert.equal((await live.handle(readCall(ACT) as ActCall)).status, 503);
});
