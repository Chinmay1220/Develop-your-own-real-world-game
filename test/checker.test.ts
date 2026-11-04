import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "../src/config.ts";
import { checkChanges } from "../src/game/checker.ts";
import { resolveStep } from "../src/game/engine.ts";
import { loadRoom } from "../src/game/room.ts";
import type { Action, Change } from "../src/game/types.ts";
import { createState } from "../src/game/world.ts";

const room = loadRoom(join(ROOT, "rooms", "sample-bedroom.json"));
const waitAll: Action[] = ["thief", "guardA", "guardB"].map((actor) => ({ actor, kind: "wait", text: "wait" }));

function reasons(changes: Change[], setup?: (state: ReturnType<typeof createState>) => void): string[] {
  const state = createState(room);
  setup?.(state);
  return checkChanges(state, waitAll, changes).rejected.map((rejection) => rejection.reason);
}

test("moves must go to a neighboring zone, once per step", () => {
  assert.match(reasons([{ op: "move", actor: "thief", to: "bathroom" }])[0], /cannot reach the bathroom door/);
  assert.match(
    reasons([
      { op: "move", actor: "thief", to: "rug" },
      { op: "move", actor: "thief", to: "rug" },
    ])[0],
    /already moved/,
  );
  assert.deepEqual(reasons([{ op: "move", actor: "thief", to: "desk" }]), []);
});

test("unknown ids are blocked", () => {
  assert.match(reasons([{ op: "move", actor: "ghost", to: "rug" }])[0], /unknown character/);
  assert.match(reasons([{ op: "pickUp", actor: "thief", object: "piano" }])[0], /unknown object/);
});

test("hiding needs a hiding spot with room, in the same zone", () => {
  assert.match(reasons([{ op: "hide", actor: "thief", object: "closet" }])[0], /not next to the closet/);
  assert.match(reasons([{ op: "hide", actor: "thief", object: "bookshelf" }])[0], /nobody can hide in the bookshelf/);
  const full = (state: ReturnType<typeof createState>) => {
    state.agents.guardA.zone = "window";
    state.agents.guardA.hiddenIn = "curtains";
  };
  assert.match(reasons([{ op: "hide", actor: "thief", object: "curtains" }], full)[0], /already full/);
});

test("objects are picked up only nearby; held objects fly up to three zones, loose ones move one", () => {
  assert.match(reasons([{ op: "pickUp", actor: "thief", object: "laptop" }])[0], /not next to the laptop/);
  const atDoor = (state: ReturnType<typeof createState>) => {
    state.agents.thief.zone = "bathroom";
  };
  assert.deepEqual(reasons([{ op: "place", object: "shoe", zone: "window" }]), []);
  assert.deepEqual(reasons([{ op: "place", object: "shoe", zone: "window" }], atDoor), []);
  assert.match(reasons([{ op: "place", object: "pillow", zone: "desk" }])[0], /cannot travel/);
});

test("switches need a switch and someone next to it", () => {
  assert.match(reasons([{ op: "set", object: "closet", key: "on", value: true }])[0], /has no switch/);
  assert.match(reasons([{ op: "set", object: "lamp", key: "on", value: false }])[0], /nobody is next to the bedside lamp/);
  assert.match(reasons([{ op: "set", object: "shoe", key: "broken", value: true }])[0], /cannot break/);
});

test("the engine applies accepted changes, skips blocked ones and reports them", () => {
  const state = createState(room);
  const { state: after, record } = resolveStep(state, waitAll, {
    changes: [
      { op: "move", actor: "thief", to: "bathroom" },
      { op: "move", actor: "guardB", to: "rug" },
    ],
    noises: [{ zone: "attic", loudness: 2, what: "a bang" }],
    narration: [],
  });
  assert.equal(after.agents.thief.zone, "window");
  assert.equal(after.agents.guardB.zone, "rug");
  assert.equal(record.rejected.length, 2);
  assert.equal(record.events.filter((event) => event.startsWith("Checker blocked")).length, 2);
});

test("a guard in the thief's zone catches the thief, and a search finds a hidden thief", () => {
  const state = createState(room);
  const caught = resolveStep(state, waitAll, { changes: [{ op: "move", actor: "thief", to: "desk" }], noises: [], narration: [] });
  assert.equal(caught.state.status, "caught");

  const hidden = createState(room);
  hidden.agents.thief.zone = "closet";
  hidden.agents.thief.hiddenIn = "closet";
  hidden.agents.guardA.zone = "closet";
  const search: Action[] = [waitAll[0], { actor: "guardA", kind: "search", target: "closet", text: "search inside the closet" }, waitAll[2]];
  assert.equal(resolveStep(hidden, search, { changes: [], noises: [], narration: [] }).state.status, "caught");
  assert.equal(resolveStep(hidden, waitAll, { changes: [], noises: [], narration: [] }).state.status, "playing");
});
