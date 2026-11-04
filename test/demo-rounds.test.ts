// Replays the scripted demo and checks the "every trick works once" loop end to end.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { createOfflineAi } from "../src/ai/offline.ts";
import { ROOT } from "../src/config.ts";
import { DEMO_ROUNDS } from "../src/demo-script.ts";
import { loadRoom } from "../src/game/room.ts";
import { Session } from "../src/game/session.ts";
import { emptyNotebook } from "../src/memory/notebook.ts";

test("each trick works once, and the teacher corrects the world model", async () => {
  const session = new Session(loadRoom(join(ROOT, "rooms", "sample-bedroom.json")), createOfflineAi(), emptyNotebook());
  for (const [index, round] of DEMO_ROUNDS.entries()) {
    if (index > 0) session.startRound();
    for (const action of round.actions) if (session.state.status === "playing") await session.act(action);
  }
  const history = session.notebook.history;
  assert.deepEqual(
    history.map((row) => [row.status, row.steps]),
    [
      ["escaped", 5], // round 1: the shoe trick works
      ["caught", 5], // round 2: Guard A no longer leaves the desk for a noise
      ["escaped", 7], // round 3: a new trick (darkness) works
      ["caught", 6], // round 4: the darkness trick fails too
    ],
  );
  assert.deepEqual(
    session.notebook.guardLessons.map((lesson) => [lesson.kind, lesson.round]),
    [
      ["distraction", 1],
      ["darkness", 3],
    ],
  );
  assert.deepEqual(
    session.notebook.worldLessons.map((lesson) => [lesson.kind, lesson.action, lesson.target, lesson.round]),
    [["forbid", "hide", "bed", 2]],
  );
  assert.equal(history[1].worldMistakes, 1);
  // Round 4, step 3: the world model now refuses the hiding spot it allowed in round 2.
  assert.ok(!session.steps[2].accepted.some((change) => change.op === "hide"));
  assert.match(session.steps[2].narration[0], /you can't/);
});

test("restarting an unfinished round keeps its number; a finished round is followed by the next", async () => {
  const session = new Session(loadRoom(join(ROOT, "rooms", "sample-bedroom.json")), createOfflineAi(), emptyNotebook());
  await session.act({ kind: "wait" });
  session.startRound();
  assert.equal(session.round, 1);
  assert.equal(session.steps.length, 0);
  for (const action of DEMO_ROUNDS[0].actions) await session.act(action);
  session.startRound();
  assert.equal(session.round, 2);
});
