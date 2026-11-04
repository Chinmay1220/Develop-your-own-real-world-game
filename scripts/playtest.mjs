// Drives headless Edge over the DevTools protocol in real time: open a page, wait, press keys, take screenshots.
// Usage: node scripts/playtest.mjs <url> <steps.json> <outDir>   (needs Microsoft Edge on Windows)
// Steps: [{"wait":2000}, {"hold":"KeyW","ms":1200}, {"press":"KeyT"}, {"shot":"name.png"}, {"eval":"js expression"}]
// Extra Edge flags can be passed in EDGE_FLAGS, for example a pretend microphone that plays a file:
//   EDGE_FLAGS="--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=speech.wav%noloop"
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [url, stepsJson, outDir] = process.argv.slice(2);
const steps = JSON.parse(stepsJson);
mkdirSync(outDir, { recursive: true });
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const port = 9300 + Math.floor(Math.random() * 500);
const edge = spawn(EDGE, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${join(outDir, "profile")}`,
  "--window-size=1400,860", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--hide-scrollbars",
  ...(process.env.EDGE_FLAGS?.split(" ").filter(Boolean) ?? []), "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let targets = [];
for (let i = 0; i < 50 && !targets.some((t) => t.type === "page"); i++) {
  await sleep(200);
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch {}
}
const page = targets.find((t) => t.type === "page");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((done) => socket.addEventListener("open", done));
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
  if (message.method === "Runtime.consoleAPICalled") console.log("console:", message.params.args.map((a) => a.value ?? a.description).join(" "));
  if (message.method === "Runtime.exceptionThrown") console.log("PAGE ERROR:", message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((done) => { const id = nextId++; pending.set(id, done); socket.send(JSON.stringify({ id, method, params })); });

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url });
const KEYS = { KeyW: ["w", 87], KeyA: ["a", 65], KeyS: ["s", 83], KeyD: ["d", 68], KeyT: ["t", 84], KeyL: ["l", 76], KeyE: ["e", 69], KeyF: ["f", 70], KeyC: ["c", 67], KeyV: ["v", 86], ShiftLeft: ["Shift", 16] };
const key = (type, code) => send("Input.dispatchKeyEvent", { type, code, key: KEYS[code][0], windowsVirtualKeyCode: KEYS[code][1] });

for (const step of steps) {
  if (step.wait) await sleep(step.wait);
  if (step.hold) { for (const code of [].concat(step.hold)) await key("keyDown", code); await sleep(step.ms ?? 1000); for (const code of [].concat(step.hold)) await key("keyUp", code); }
  if (step.press) { await key("keyDown", step.press); await sleep(60); await key("keyUp", step.press); }
  if (step.eval) { const result = await send("Runtime.evaluate", { expression: step.eval, returnByValue: true }); console.log("eval:", JSON.stringify(result.result?.result?.value ?? result.result)); }
  if (step.shot) { const result = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(outDir, step.shot), Buffer.from(result.result.data, "base64")); console.log("saved", step.shot); }
}
await send("Browser.close").catch(() => {});
edge.kill();
process.exit(0);
