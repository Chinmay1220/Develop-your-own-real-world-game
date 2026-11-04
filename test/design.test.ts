import assert from "node:assert/strict";
import { test } from "node:test";
import { createOfflineAi } from "../src/ai/offline.ts";
import type { Designer, DesignRequest } from "../src/ai/types.ts";
import { buildRoom } from "../src/design/build.ts";
import { checkDesign } from "../src/design/check.ts";
import { designLevel } from "../src/design/designer.ts";
import { EXAMPLE_DESIGN } from "../src/design/example.ts";
import type { GameDesign } from "../src/design/types.ts";
import { validateRoom } from "../src/game/room.ts";
import { Session } from "../src/game/session.ts";
import { createState, isLit, visibleZones } from "../src/game/world.ts";
import { emptyNotebook } from "../src/memory/notebook.ts";

const design = () => structuredClone(EXAMPLE_DESIGN);

function problemsAfter(change: (design: GameDesign) => void): string {
  const broken = design();
  change(broken);
  return checkDesign(broken).join("\n");
}

test("the example design passes every check and builds a valid room", () => {
  assert.deepEqual(checkDesign(design()), []);
  assert.deepEqual(validateRoom(buildRoom(design())), []);
});

test("hunters see through doorways but not through doors", () => {
  const state = createState(buildRoom(design()));
  assert.deepEqual(visibleZones(state, "gallery").sort(), ["diamond_room", "gallery", "hall"]);
  assert.ok(!visibleZones(state, "diamond_room").includes("office"));
});

test("a power box darkens only the rooms it lights", () => {
  const state = createState(buildRoom(design()));
  state.objects.power_box.on = false;
  assert.equal(isLit(state, "hall"), false);
  assert.equal(isLit(state, "gallery"), false);
  assert.equal(isLit(state, "diamond_room"), true);
  assert.equal(isLit(state, "loading_dock"), true); // no light reaches it, so it is never dark
  assert.ok(!visibleZones(state, "diamond_room").includes("gallery"));
});

test("the checker says what is wrong, in words the designer can act on", () => {
  assert.match(
    problemsAfter((broken) => Object.assign(broken.rooms[1], { col: 0, row: 2 })),
    /Rooms "loading_dock" and "storage" overlap/,
  );
  assert.match(
    problemsAfter((broken) => broken.connections.push({ from: "loading_dock", to: "office", kind: "door" })),
    /"loading_dock" and "office" are connected but do not share a wall/,
  );
  assert.match(
    problemsAfter((broken) => (broken.connections = broken.connections.filter((link) => link.to !== "office"))),
    /Room "office" cannot be reached/,
  );
  assert.match(
    problemsAfter((broken) => (broken.target = "vase_pedestal")),
    /cannot be carried/,
  );
  assert.match(
    problemsAfter((broken) => (broken.hunters[0].room = "loading_dock")),
    /caught at once/,
  );
  assert.match(
    problemsAfter((broken) => (broken.hunters[1].room = "hall")),
    /can see into the player's start room/,
  );
  assert.match(
    problemsAfter((broken) => (broken.objects[0].kind = "dragon")),
    /unknown kind "dragon"/,
  );
  assert.match(
    problemsAfter((broken) => (broken.objects[0].kind = "car")),
    /needs a room of at least 2 cells/,
  );
});

test("creatures, drawn shapes and the list of what couldn't be shown carry into the level", () => {
  const custom = design();
  custom.style = "forest";
  custom.player = { look: "ant", color: "#3a1d12", room: "loading_dock" };
  custom.missing = ["a talking tree"];
  custom.objects[0].parts = [
    { shape: "cone", x: 0, y: 0.6, z: 0, w: 1.2, h: 1.2, d: 1.2, color: "#8a5a36" },
    { shape: "blob", x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, color: "#ffffff" }, // not a shape: dropped
    { shape: "box", x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, color: "red" }, // not a #rrggbb colour: dropped
  ];
  assert.deepEqual(checkDesign(custom), []);
  const room = buildRoom(custom);
  assert.equal(room.agents[0].look, "ant");
  assert.equal(room.agents[0].color, "#3a1d12");
  assert.equal(room.objects[0].parts?.length, 1);
  assert.deepEqual(room.missing, ["a talking tree"]);
});

test("problems go back to the designer until the level is playable", async () => {
  const requests: DesignRequest[] = [];
  const broken = design();
  broken.target = "vase_pedestal";
  const designer: Designer = {
    model: "test",
    usage: () => null,
    async design(request) {
      requests.push(structuredClone(request));
      return requests.length === 1 ? broken : design();
    },
  };
  const result = await designLevel("a museum heist", designer);
  assert.equal(result.attempts.length, 2);
  assert.equal(requests[1].previous?.target, "vase_pedestal");
  assert.match(requests[1].problems.join("\n"), /cannot be carried/);
  assert.equal(result.room.prompt, "a museum heist");
});

test("a designed level can be played, and patrolling guards walk their route", async () => {
  const session = new Session(buildRoom(design()), createOfflineAi(), emptyNotebook());
  await session.act({ kind: "move", target: "storage" });
  assert.equal(session.state.agents.milo.zone, "hall");
  await session.act({ kind: "wait" });
  assert.equal(session.state.agents.milo.zone, "gallery");
  assert.equal(session.state.status, "playing");
});
