// Makes a game from the player's words: the writer writes it, a hidden browser plays it, a reviewer
// looks at screenshots, and any errors or visible problems go back to the writer, up to maxFixes times.
import { gameId, saveGame, type Game } from "./games.ts";
import type { GameReviewer } from "./reviewer.ts";
import type { TestReport } from "./tester.ts";
import type { GameWriter } from "./writer.ts";

export interface MakeResult {
  game: Game;
  attempts: string[][]; // the problems found in each version; the last is empty if it works
  report: TestReport;
}

export async function makeGame(
  prompt: string,
  writer: GameWriter,
  test: (id: string) => Promise<TestReport>,
  { maxFixes = 2, log = (_line: string) => {}, reviewer = null as GameReviewer | null } = {},
): Promise<MakeResult> {
  const attempts: string[][] = [];
  let previous: { code: string; problems: string[] } | undefined;
  let id = "";
  for (let version = 1; ; version++) {
    const startedAt = performance.now();
    log(`version ${version}: ${writer.model} is writing…`);
    const written = await writer.write({ prompt, previous });
    id ||= gameId(written.title); // later versions replace the first
    const game: Game = { id, ...written, prompt, model: writer.model, made: new Date().toISOString() };
    saveGame(game);
    log(`version ${version}: "${game.title}", ${game.code.split("\n").length} lines, written in ${((performance.now() - startedAt) / 1000).toFixed(0)} s. Testing…`);

    const report = await test(id);
    for (const line of report.live) log(`version ${version}: Meta's AI in the game: ${line.slice(0, 300)}`);
    const problems = [...report.errors, ...(report.ready || report.errors.length ? [] : ["The game never started: it drew nothing in 25 seconds."])];
    saveGame(game, report.screenshot);
    if (problems.length === 0 && reviewer && report.views.length) {
      // It runs; now check that it looks right.
      const seen = await reviewer.review({ prompt, title: game.title, controls: game.controls, views: report.views });
      problems.push(...seen.map((problem) => `A reviewer looking at screenshots of the running game saw: ${problem}`));
      log(seen.length ? `version ${version}: runs, but the reviewer saw: ${seen.join(" | ").slice(0, 500)}` : `version ${version}: runs, and the reviewer saw no problems`);
    } else {
      log(problems.length ? `version ${version}: ${problems.length} problem(s): ${problems.join(" | ").slice(0, 400)}` : `version ${version}: runs with no errors`);
    }
    attempts.push(problems);
    if (problems.length === 0 || version > maxFixes) return { game, attempts, report };
    previous = { code: game.code, problems };
  }
}
