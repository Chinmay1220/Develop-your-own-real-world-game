import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "../src/config.ts";
import { observe } from "../src/game/perception.ts";
import { loadRoom, validateRoom } from "../src/game/room.ts";
import { createState, distance, findPath, visibleZones } from "../src/game/world.ts";

const room = loadRoom(join(ROOT, "rooms", "sample-bedroom.json"));

test("the sample room has no broken references", () => {
  assert.deepEqual(validateRoom(room), []);
});

test("room validation catches a one-way path", () => {
  const broken = structuredClone(room);
  broken.zones.find((zone) => zone.id === "bathroom")!.neighbors = ["door"];
  assert.match(validateRoom(broken).join("\n"), /"closet" and "bathroom" must list each other/);
});

test("the bookshelf blocks the view between the window and the desk", () => {
  const state = createState(room);
  assert.ok(!visibleZones(state, "window").includes("desk"));
  assert.ok(!visibleZones(state, "desk").includes("window"));
  assert.ok(visibleZones(state, "rug").includes("desk"));
});

test("in the dark, characters only see their own zone", () => {
  const state = createState(room);
  state.objects.lamp.on = false;
  assert.deepEqual(visibleZones(state, "rug"), ["rug"]);
});

test("paths follow the neighbor order and distances count steps", () => {
  const state = createState(room);
  assert.deepEqual(findPath(state, "desk", "bathroom"), ["desk", "closet", "bathroom"]);
  assert.equal(distance(state, "window", "bathroom"), 3);
});

test("a loudness-2 noise is heard two zones away but not three", () => {
  const state = createState(room);
  state.agents.guardA.zone = "desk"; // 2 steps from the bathroom door
  state.agents.guardB.zone = "window"; // 3 steps away
  const seen = observe(state, state, [{ zone: "bathroom", loudness: 2, what: "a thud" }]);
  assert.equal(seen.guardA.heard.length, 1);
  assert.equal(seen.guardB.heard.length, 0);
});

test("a guard who can see the thief's zone sees the thief, unless the thief is hidden", () => {
  const state = createState(room);
  state.agents.thief.zone = "rug";
  assert.equal(observe(state, state, []).guardA.thiefSeenAt, "rug");
  const hidden = structuredClone(state);
  hidden.agents.thief.zone = "closet";
  hidden.agents.thief.hiddenIn = "closet";
  const seen = observe(state, hidden, []);
  assert.equal(seen.guardA.thiefSeenAt, null);
  assert.equal(seen.guardA.sawHideIn, "closet");
});
