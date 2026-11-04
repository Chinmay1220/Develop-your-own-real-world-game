import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { Lesson } from "../src/ai/types.ts";
import { interpret, offlineWorldModel } from "../src/ai/offline.ts";
import { ROOT } from "../src/config.ts";
import { loadRoom } from "../src/game/room.ts";
import type { Action } from "../src/game/types.ts";
import { createState } from "../src/game/world.ts";

const room = loadRoom(join(ROOT, "rooms", "sample-bedroom.json"));
const typed = (text: string): Action => ({ actor: "thief", kind: "free", text });

test("typed actions become structured actions when the words are clear", () => {
  const state = createState(room);
  const read = (text: string) => {
    const { kind, target, item } = interpret(state, typed(text));
    return { kind, target, item };
  };
  assert.deepEqual(read("throw my shoe at the bathroom door"), { kind: "throw", target: "bathroom", item: "shoe" });
  assert.deepEqual(read("hide under the bed"), { kind: "hide", target: "bed", item: undefined });
  assert.deepEqual(read("turn off the lamp"), { kind: "use", target: "lamp", item: undefined });
  assert.deepEqual(read("sneak to the desk"), { kind: "move", target: "desk", item: undefined });
  assert.deepEqual(read("go to the door"), { kind: "move", target: "door", item: undefined });
  assert.equal(read("dance a little").kind, "free");
});

test("the offline world model follows world lessons from the teacher", async () => {
  const state = createState(room);
  state.agents.thief.zone = "bed";
  const before = await offlineWorldModel.resolve(state, [typed("hide under the bed")], []);
  assert.deepEqual(before.changes, [{ op: "hide", actor: "thief", object: "bed" }]);

  const lesson: Lesson = { id: "W1", kind: "forbid", action: "hide", target: "bed", round: 1, text: "There is no space under the bed." };
  const after = await offlineWorldModel.resolve(state, [typed("hide under the bed")], [lesson]);
  assert.deepEqual(after.changes, []);
  assert.match(after.narration[0], /you can't/);
});

test("a thrown mug breaks and makes the loudest noise", async () => {
  const state = createState(room);
  state.agents.thief.zone = "desk";
  state.objects.mug.zone = null;
  state.objects.mug.heldBy = "thief";
  const outcome = await offlineWorldModel.resolve(state, [typed("throw the mug at the bed")], []);
  assert.deepEqual(outcome.noises.map((noise) => [noise.zone, noise.loudness]), [["bed", 3]]);
  assert.ok(outcome.changes.some((change) => change.op === "set" && change.key === "broken"));
});
