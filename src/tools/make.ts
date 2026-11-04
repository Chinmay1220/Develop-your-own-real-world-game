// Makes games from your words: Meta's model writes each one, a hidden browser tests it, and errors
// go back to be fixed. The server must be running (npm start), because the test plays the game there.
// Run with: npm run make -- "a racing game on Mars"      (several ideas make several games)
import { config } from "../config.ts";
import { GAMES_DIR } from "../make/games.ts";
import { makeGame } from "../make/maker.ts";
import { createReviewer } from "../make/reviewer.ts";
import { testGame } from "../make/tester.ts";
import { createWriter } from "../make/writer.ts";

const prompts = process.argv
  .slice(2)
  .map((text) => text.trim())
  .filter(Boolean);
const writer = createWriter();
if (!writer) {
  console.error("Making games needs MODEL_API_KEY in .env.");
  process.exit(1);
}
if (prompts.length === 0) {
  console.error('Describe the game you want, for example: npm run make -- "a racing game on Mars"');
  process.exit(1);
}
try {
  await fetch(`http://localhost:${config.port}/api/catalog`);
} catch {
  console.error(`Start the server first (npm start): the test plays the game at http://localhost:${config.port}.`);
  process.exit(1);
}

const reviewer = createReviewer();
const spent = () => (writer.usage()?.usd ?? 0) + (reviewer?.usage()?.usd ?? 0);
console.log(`Writer: ${writer.model}. Reviewer: ${reviewer?.model ?? "none"}`);
for (const prompt of prompts) {
  console.log(`\n=== "${prompt.split("\n")[0].slice(0, 120)}" ===`);
  const costBefore = spent();
  const startedAt = performance.now();
  const { game, attempts, report } = await makeGame(prompt, writer, (id) => testGame(id, config.port), { log: (line) => console.log(`  ${line}`), reviewer });
  const minutes = ((performance.now() - startedAt) / 60000).toFixed(1);
  const works = attempts.at(-1)!.length === 0;
  console.log(`${works ? "Works" : "Still has problems"} after ${attempts.length} version(s), ${minutes} min, $${(spent() - costBefore).toFixed(3)}`);
  console.log(`  ${game.title}: ${game.pitch}`);
  console.log(`  Controls: ${game.controls}`);
  if (report.events.length) console.log(`  During the test: ${report.events.join("; ")}`);
  console.log(`  Play: http://localhost:${config.port}/play.html?game=${game.id}`);
  console.log(`  Code and screenshot: ${GAMES_DIR}\\${game.id}.json / .png`);
}
for (const [role, client] of [["writer", writer], ["reviewer", reviewer]] as const) {
  for (const [model, row] of Object.entries(client?.usage()?.byModel ?? {})) {
    console.log(`\n${role} ${model}: ${row.calls} calls, ${row.inputTokens} tokens in, ${row.outputTokens} out, $${row.usd.toFixed(3)}`);
  }
}
