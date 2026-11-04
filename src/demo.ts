// Plays the scripted rounds with the offline stand-ins and prints the story.
// Run with: npm run demo
import { join } from "node:path";
import { createOfflineAi } from "./ai/offline.ts";
import { ROOT } from "./config.ts";
import { DEMO_ROUNDS } from "./demo-script.ts";
import { loadRoom } from "./game/room.ts";
import { Session, type RoundReport } from "./game/session.ts";
import { emptyNotebook } from "./memory/notebook.ts";

const RESULT: Record<string, string> = { escaped: "ESCAPED", caught: "CAUGHT", timeout: "TIME UP", playing: "UNFINISHED" };

const room = loadRoom(join(ROOT, "rooms", "sample-bedroom.json"));
const session = new Session(room, createOfflineAi(), emptyNotebook());

console.log("HOME HEIST · scripted demo with the offline stand-in models");
console.log(`Room: ${room.name}. Goal: take the ${room.targetId} and leave by an exit.`);
console.log("Guard A protects the laptop at the desk. Guard B watches the door.");

for (const [index, round] of DEMO_ROUNDS.entries()) {
  if (index > 0) session.startRound();
  console.log(`\n=== Round ${session.round}: ${round.title} ===`);
  console.log(round.idea);
  for (const action of round.actions) {
    if (session.state.status !== "playing") break;
    const { record, report } = await session.act(action);
    console.log(`\n  Step ${record.step}  > ${record.actions[0].text}`);
    for (const line of [...record.narration, ...record.events]) console.log(`           ${line}`);
    if (report) printReport(report);
  }
}

console.log("\n=== Summary ===");
console.log("Round  Result    Steps  World-model mistakes found  New guard lessons");
for (const row of session.notebook.history) {
  console.log(
    `${String(row.round).padEnd(7)}${RESULT[row.status].padEnd(10)}${String(row.steps).padEnd(7)}${String(row.worldMistakes).padEnd(28)}${row.newGuardLessons}`,
  );
}

function printReport(report: RoundReport): void {
  console.log(`\n  Result: ${RESULT[report.status]} after ${report.steps} steps.`);
  console.log(
    report.newGuardLessons.length > 0
      ? `  The guards wrote in their notebook:\n${report.newGuardLessons.map((lesson) => `    - ${lesson.text}`).join("\n")}`
      : "  The guards learned nothing new.",
  );
  if (report.newWorldLessons.length > 0) {
    console.log(`  The teacher found a world-model mistake and saved a world lesson:`);
    for (const mistake of report.mistakes) console.log(`    - Step ${mistake.step}: ${mistake.problem}`);
  }
}
