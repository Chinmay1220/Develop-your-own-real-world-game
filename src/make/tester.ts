// Plays a freshly written game in a hidden browser: waits for it to start, presses the usual keys,
// clicks, says the game's example to Meta's world model, and reports errors and a screenshot.
// The errors go back to the writer to fix.
import { Browser, sleep } from "./browser.ts";
import { loadGame } from "./games.ts";

export interface TestReport {
  ready: boolean; // the game drew its first frames
  errors: string[];
  events: string[]; // win, lose and other messages from the game
  live: string[]; // what the world model and the characters' minds decided
  screenshot: Buffer | null; // after playing a little, saved with the game
  views: string[]; // JPEG data URLs, just after the start and after playing, for the reviewer
}

export async function testGame(id: string, port: number): Promise<TestReport> {
  const example = loadGame(id)?.example?.trim();
  const browser = await Browser.open();
  try {
    await browser.goto(`http://localhost:${port}/play.html?game=${encodeURIComponent(id)}`);
    const lines = () => browser.console.filter((line) => line.startsWith("GAME ") || line.startsWith("PAGE ERROR"));
    const waitFor = async (test: (line: string) => boolean, ms: number) => {
      for (let waited = 0; waited < ms && !lines().some(test); waited += 250) await sleep(250);
    };
    // Wait for the first frames (characters load from the internet), or an error.
    await waitFor((line) => /^GAME (ready|error)/.test(line) || line.startsWith("PAGE ERROR"), 25_000);
    const readyAt = Date.now();
    await sleep(1500);
    const jpeg = async () => `data:image/jpeg;base64,${(await browser.screenshot("jpeg")).toString("base64")}`;
    const atStart = await jpeg();
    // Play a little: the keys most games use, and a click in the middle.
    await browser.hold(["ArrowUp", "KeyW"], 1200);
    await browser.press("Space");
    await browser.hold(["ArrowLeft", "KeyA"], 700);
    await browser.press("Space");
    await browser.hold(["ArrowRight", "KeyD"], 700);
    await browser.click(640, 380);
    await browser.hold(["ArrowUp", "KeyW", "ShiftLeft"], 900);
    // A round that is already over was too hard (or too easy) to be fair: a person would barely have started.
    const ended = lines().find((line) => /^GAME (win|lose)/.test(line));
    const unfair = ended
      ? `The round ended ("${ended.replace(/^GAME /, "")}") only ${Math.round((Date.now() - readyAt) / 1000)} s after the game started, while the test was just pressing arrow keys, WASD and Space without aiming. Give the player a fair start: nothing can catch, hit or beat them in the first 10 seconds, enemies start far away or facing away, and the goal takes real play to reach.`
      : null;
    // Talk to the world model the way a player would, and wait for its answer.
    const asked = Boolean(example) && !ended; // once the round is over, the world model rightly takes no more actions
    if (asked && example) {
      await browser.press("Enter");
      await sleep(300);
      await browser.type(example);
      await browser.press("Enter");
      await waitFor((line) => line.startsWith("GAME live: player tries"), 20_000);
      await browser.hold(["ArrowUp", "KeyW"], 800);
    }
    await sleep(1200);
    const screenshot = await browser.screenshot();
    const afterPlaying = await jpeg();
    const all = lines();
    const errors = all.filter((line) => line.startsWith("GAME error") || line.startsWith("PAGE ERROR")).map((line) => line.replace(/^GAME error: /, ""));
    const live = all.filter((line) => line.startsWith("GAME live: ")).map((line) => line.slice("GAME live: ".length));
    if (asked && !live.some((line) => line.startsWith("player tries"))) {
      errors.push(`The test pressed Enter, typed "${example}" and pressed Enter, but nothing reached the world model. Make a kit.world(...) when the game starts, and don't use Enter for anything else.`);
    }
    if (unfair) errors.push(unfair);
    return {
      ready: all.some((line) => line.startsWith("GAME ready")),
      errors: [...new Set(errors)].slice(0, 6),
      events: all.filter((line) => /^GAME (win|lose)/.test(line)),
      live,
      screenshot,
      views: [atStart, afterPlaying],
    };
  } finally {
    await browser.close();
  }
}
