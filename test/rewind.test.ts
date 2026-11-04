import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cleanInvestigation, Rewind, type Brain, type Hypothesis, type Painter } from "../src/rewind/engine.ts";

const theory = (title: string, likelihood: number, seconds: number[]): Hypothesis => ({
  title,
  likelihood,
  physics: "50 km/h",
  timeline: seconds.map((secondsBefore) => ({ secondsBefore, what: `at ${secondsBefore}`, picture: `moment ${secondsBefore}` })),
  supports: ["marks"],
  against: [],
  prevention: "slow down",
});

test("the investigation is kept in bounds: pins on the photo, likelihoods adding up to 100, moments earliest first", () => {
  const clean = cleanInvestigation({
    scene: "a car",
    summary: "it slid",
    evidence: [{ label: "marks", x: 1.4, y: -0.2 }],
    hypotheses: [theory("swerve", 1, [1, 10, 3]), theory("slide", 3, [5, 0, 2])],
  });
  assert.deepEqual(clean.evidence, [{ label: "marks", x: 1, y: 0 }]);
  assert.deepEqual(clean.hypotheses.map((h) => [h.title, h.likelihood]), [["slide", 75], ["swerve", 25]]);
  assert.deepEqual(clean.hypotheses[1].timeline.map((m) => m.secondsBefore), [10, 3, 1]);
  assert.deepEqual(clean.hypotheses[0].timeline.map((m) => m.secondsBefore), [5, 2]); // "0 seconds before" is the photo itself
});

test("moments are painted backwards from the photo, each from the one after it, and a refused picture is painted in calmer words", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rewind-"));
  try {
    const painted: { prompt: string; from: string }[] = [];
    const brain: Brain = {
      investigate: async () => ({ scene: "s", summary: "x", evidence: [], hypotheses: [theory("slide", 1, [10, 3, 1])] }),
      calm: async (picture) => `calm ${picture}`,
    };
    const painter: Painter = {
      async paint(prompt, from) {
        if (prompt.includes("moment 3") && !prompt.includes("calm")) throw new Error('Meta API 400: {"error":{"code":"content_policy_violation"}}');
        painted.push({ prompt, from: from.toString() });
        return Buffer.from(prompt.slice(prompt.indexOf("Show: ") + 6));
      },
    };
    const rewind = new Rewind(brain, painter, { dir });
    const record = await rewind.start(Buffer.from("PHOTO"), "rain");
    assert.equal((await rewind.frame(record.id, 0, 0))!.toString(), "moment 10");
    assert.deepEqual(painted.map((p) => p.from), ["PHOTO", "moment 1", "calm moment 3"]);
    assert.deepEqual(rewind.get(record.id)!.painted[0], ["yes", "yes", "yes"]);
    assert.equal(rewind.paint(record.id, 0).painted[0][0], "yes"); // asking again paints nothing more
    assert.equal(painted.length, 3);
    assert.throws(() => rewind.paint(record.id, 5), /No such explanation/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
