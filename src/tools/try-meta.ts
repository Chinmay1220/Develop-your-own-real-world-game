// Plays scripted rounds with the real Meta models and reports the time and cost of each step.
// Run with: npm run api:try          (round 1 only, a few cents)
//           npm run api:try -- 2     (the first 2 rounds, keeping the notebook between them)
import { join } from "node:path";
import { createAi } from "../ai/index.ts";
import { config, ROOT } from "../config.ts";
import { DEMO_ROUNDS } from "../demo-script.ts";
import { loadRoom } from "../game/room.ts";
import { Session } from "../game/session.ts";
import type { Change } from "../game/types.ts";
import { emptyNotebook } from "../memory/notebook.ts";

if (!config.apiKey) {
  console.error("MODEL_API_KEY is not set. Copy .env.example to .env and put your key after MODEL_API_KEY=");
  process.exit(1);
}

const roundCount = Math.min(Math.max(Number(process.argv[2]) || 1, 1), DEMO_ROUNDS.length);
const ai = createAi("meta");
const session = new Session(loadRoom(join(ROOT, "rooms", "sample-bedroom.json")), ai, emptyNotebook());
const spent = () => ai.usage()?.usd ?? 0;

console.log(`Meta models: ${Object.entries(ai.models).map(([role, model]) => `${role} = ${model}`).join(", ")}`);
console.log("Times are what a player waits after acting. The guards decide while the player is still choosing.");

for (const [index, round] of DEMO_ROUNDS.slice(0, roundCount).entries()) {
  if (index > 0) session.startRound();
  console.log(`\n=== Round ${session.round}: ${round.title} ===`);
  for (const action of round.actions) {
    if (session.state.status !== "playing") break;
    const costBefore = spent();
    await session.guardsReady(); // a real player would still be choosing here
    const startedAt = performance.now();
    const { record, report } = await session.act(action);
    const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    const note = report ? ", including the end-of-round review" : "";
    console.log(`\nStep ${record.step}  > ${record.actions[0].text}   (${seconds} s, $${(spent() - costBefore).toFixed(4)}${note})`);
    for (const guardAction of record.actions.slice(1)) console.log(`  [${guardAction.actor} chose: ${guardAction.text}]`);
    for (const line of [...record.narration, ...record.events]) console.log(`  ${line}`);
    console.log(`  changes: ${record.accepted.map(describeChange).join(", ") || "none"}`);
    console.log(`  noises: ${record.noises.map((noise) => `${noise.what} at ${noise.zone} (loudness ${noise.loudness})`).join("; ") || "none"}`);
    if (report) {
      console.log(`\nResult: ${report.status} after ${report.steps} steps.`);
      for (const lesson of report.newGuardLessons) console.log(`  New guard lesson: ${lesson.text}`);
      for (const mistake of report.mistakes) console.log(`  Teacher, step ${mistake.step}: ${mistake.problem}`);
      for (const lesson of report.newWorldLessons) console.log(`  New world lesson: ${lesson.text}`);
      for (const warning of report.warnings) console.log(`  Warning: ${warning}`);
    }
  }
  if (session.state.status === "playing") console.log("\nThe script ended before the round did.");
}

const usage = ai.usage();
if (usage) {
  console.log(`\nTotal: ${usage.calls} calls, $${usage.usd.toFixed(4)}`);
  for (const [model, row] of Object.entries(usage.byModel)) {
    console.log(`  ${model}: ${row.calls} calls, ${row.inputTokens} tokens in (${row.cachedTokens} cached), ${row.outputTokens} out, $${row.usd.toFixed(4)}`);
  }
}

function describeChange(change: Change): string {
  switch (change.op) {
    case "move":
      return `${change.actor} → ${change.to}`;
    case "hide":
      return `${change.actor} hides in ${change.object}`;
    case "unhide":
      return `${change.actor} leaves hiding`;
    case "pickUp":
      return `${change.actor} picks up ${change.object}`;
    case "place":
      return `${change.object} lands at ${change.zone}`;
    case "set":
      return `${change.object}.${change.key} = ${change.value}`;
  }
}
