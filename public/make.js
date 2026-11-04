// Speak any game: say or type an idea, the server has Meta's model write the game, tests it in a hidden
// browser and fixes errors, then the game plays here in a sealed frame. While it plays, a glass panel
// shows what Meta's AI decides inside the game, and what it learns after each round.
import { aurora } from "./design/aurora.js";
import { spotlight } from "./design/spotlight.js";
import { shinyText, textRotate } from "./design/text.js";
import { runGame } from "./sandbox.js";
import { startRecording } from "./voice.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const catalog = await (await fetch("/api/catalog")).json();
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
let current = null; // the running game frame
let playing = null; // the game on screen

// Example worlds: a chip each, a marker on the globe, and a phrase for the rotating line.
const EXAMPLES = [
  { label: "Paris museum heist", phrase: "a night heist in Paris", place: [48.86, 2.34], text: "A night heist in a Paris museum: I steal a golden statue while two security guards patrol with flashlights, and escape through the back door." },
  { label: "Caribbean pirates", phrase: "a pirate battle at sunset", place: [18.2, -66.5], text: "A pirate cove at sunset in the Caribbean: I defend the beach with a cannon against an enemy ship and its landing crew." },
  { label: "New York police chase", phrase: "a police chase in New York", place: [40.71, -74.0], text: "A police chase through New York streets at night: I'm a thief running from two police officers who learn my shortcuts." },
  { label: "Alpine farm", phrase: "a fox on an Alpine farm", place: [46.8, 8.2], text: "A farm in the Swiss Alps: I'm a farmer protecting my chickens from a clever fox that learns my tricks." },
  { label: "Monaco Grand Prix", phrase: "an F1 race at Monaco", place: [43.73, 7.42], text: "A Formula 1 race at Monaco against two rival drivers who learn my racing line." },
  { label: "London hospital", phrase: "a race against time in a hospital", place: [51.5, -0.12], text: "A busy London hospital: I'm a nurse rushing between patients before time runs out, with a doctor giving orders." },
  { label: "Tokyo rooftops", phrase: "a dragon over Tokyo", place: [35.68, 139.69], text: "Escape a dragon across neon rooftops in Tokyo at night." },
  { label: "Sahara night", phrase: "a night in the Sahara", place: [23.4, 12.9], text: "Survive a night in a desert camp in the Sahara: keep the fire going and the supplies safe until dawn." },
];

// The look --------------------------------------------------------------------------------------
aurora($("aurora"), { colorStops: ["#e0731e", "#7c5cff", "#f5b942"], amplitude: 1.1, blend: 0.55, height: 0.5, layers: 2, glow: 0.7, brightness: 0.95, speed: 0.7 });
shinyText($("shiny"), { color: "#e9ecf3", shineColor: "#ffd27a", speed: 2.4, delay: 2.2, shineWidth: 28 });

let world = null;
import("./design/globe.js")
  .then(({ globe }) => (world = globe($("globe"), { markers: EXAMPLES.map(({ place }) => ({ location: place, size: 0.04 })) })))
  .catch(() => ($("globe").hidden = true)); // the globe is decoration: the page works without it

const rotate = textRotate($("rotate"), EXAMPLES.map((example) => example.phrase), {
  interval: 3000,
  onChange: (_phrase, i) => {
    world?.focus(EXAMPLES[i].place);
    for (const chip of $("examples").children) chip.classList.toggle("on", Number(chip.dataset.i) === i);
  },
});
$("examples").replaceChildren(
  ...EXAMPLES.map((example, i) => {
    const chip = Object.assign(document.createElement("button"), { className: "chip", textContent: example.label });
    chip.dataset.i = i;
    chip.addEventListener("click", () => {
      $("prompt").value = example.text;
      rotate.stop();
      rotate.jump(i);
      $("prompt").focus();
    });
    return chip;
  }),
);
for (const step of document.querySelectorAll(".step")) spotlight(step, { color: "#f5b942", intensity: 0.12, size: 260 });

function say(text, error = false) {
  $("status").className = error ? "error" : "";
  $("status").textContent = text;
}

// The gallery -----------------------------------------------------------------------------------
async function refresh(selected) {
  // Only games Meta's AI wrote; hand-made tests and replaced versions stay out of the gallery.
  const games = (await (await fetch("/api/games")).json()).filter((game) => game.model.startsWith("muse") && !game.archived);
  $("games").replaceChildren(
    ...games.map((game) => {
      const card = Object.assign(document.createElement("button"), { className: "card" });
      const badges = [game.features.world && '<span class="ai">Meta\'s AI inside</span>', game.features.scanned && '<span class="real">Real scanned world</span>', game.features.people && '<span class="people">Real people</span>'].filter(Boolean).join("");
      card.innerHTML = `<div class="shot">${game.features.shot ? `<img alt="" loading="lazy" src="/api/games/${encodeURIComponent(game.id)}/shot.png">` : ""}<span class="play">Play ▸</span></div><div class="body"><b>${escapeHtml(game.title)}</b><span class="pitch">${escapeHtml(game.pitch)}</span><i>“${escapeHtml(game.prompt)}”</i>${badges ? `<div class="badges">${badges}</div>` : ""}</div>`;
      card.addEventListener("click", () => play(game.id));
      spotlight(card, { color: "#ffffff", intensity: 0.1, size: 220 });
      return card;
    }),
  );
  if (!games.length) $("games").innerHTML = '<p style="color:var(--dim)">No games yet. Say one above.</p>';
  if (selected) play(selected);
}

// Playing ---------------------------------------------------------------------------------------
/** Speech to text for what the player says to the world model during play (the game can't use the microphone). */
async function listen() {
  const { wav, spoke } = await startRecording({ maxSeconds: 20, pauseSeconds: 1.2 }).done;
  if (!spoke) throw new Error("I didn't hear anything. Try again, or type.");
  const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return { text: result.text };
}

/** One line in the panel for each question the game asked Meta's AI. */
function logLive({ call, result, error }) {
  const line = document.createElement("div");
  const who = call.kind === "act" ? (call.by === "game" ? "The game asked" : "You tried") : call.kind === "think" ? `${call.name} thought` : "After the round";
  const what = error ? `failed: ${error}` : call.kind === "act" ? `“${call.text}” → ${result.story}` : call.kind === "think" ? `${result.thought}${result.say ? ` “${result.say}”` : ""}` : `Muse Wonder learned: ${result.summary}`;
  const changes = (result?.changes ?? []).map(({ name, input }) => `${name}(${Object.values(input).join(", ")})`).join(", ");
  line.className = error ? "failed" : call.kind === "think" ? "mind" : call.kind === "learn" ? "learn" : "";
  line.innerHTML = `<b>${escapeHtml(who)}:</b> ${escapeHtml(what)}${changes ? ` <i>[${escapeHtml(changes)}]</i>` : ""}`;
  $("ai-log").prepend(line);
  while ($("ai-log").children.length > 60) $("ai-log").lastChild.remove();
}

async function showLessons(game) {
  const lessons = await (await fetch(`/api/live/${encodeURIComponent(game.id)}`)).json();
  const example = game.example ? ` Try: “${escapeHtml(game.example)}”.` : "";
  const learned = lessons.rounds ? ` It has learned from ${lessons.rounds} round${lessons.rounds === 1 ? "" : "s"} so far.` : "";
  $("ai-tip").innerHTML = `Click the game, press <kbd>Enter</kbd> and type or speak anything to try: the world model decides what happens.${example}${learned}`;
  $("forget").hidden = !lessons.rounds;
}

async function play(id) {
  const response = await fetch(`/api/games/${encodeURIComponent(id)}`);
  if (!response.ok) return;
  const game = await response.json();
  current?.stop();
  playing = game;
  $("studio").hidden = true;
  $("player").hidden = false;
  document.body.style.overflow = "hidden";
  $("game-title").textContent = game.title;
  $("game-pitch").textContent = game.controls || game.pitch;
  $("errors").textContent = "";
  $("ai-log").textContent = "";
  const alive = /kit\.(world|mind)\(/.test(game.code); // games made before Meta's AI ran inside them have none
  $("toggle-ai").hidden = !alive;
  showPanel(alive);
  if (alive) showLessons(game);
  current = await runGame(
    $("game"),
    game,
    catalog,
    (message) => {
      if (message.kind === "error") $("errors").textContent += `${message.message}\n`;
      if (message.kind === "live") {
        logLive(message);
        if (message.call.kind === "learn" && message.result) showLessons(game);
      }
    },
    { listen },
  );
  history.replaceState(null, "", `?game=${encodeURIComponent(id)}`);
}

function leave() {
  current?.stop();
  current = null;
  playing = null;
  $("player").hidden = true;
  $("studio").hidden = false;
  document.body.style.overflow = "";
  history.replaceState(null, "", location.pathname);
}
$("back").addEventListener("click", leave);
/** Shows or hides Meta's AI panel; the game makes room for it. */
function showPanel(on) {
  $("ai").hidden = !on;
  $("player").classList.toggle("with-ai", on);
}
$("toggle-ai").addEventListener("click", () => showPanel($("ai").hidden));
$("forget").addEventListener("click", async () => {
  if (!playing) return;
  await fetch("/api/live/forget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game: playing.id }) });
  await showLessons(playing);
  logLive({ call: { kind: "learn" }, result: { summary: "nothing: it forgot what it learned, so the next round starts fresh." } });
});

// Making ----------------------------------------------------------------------------------------
/** Which stage a line from the game maker belongs to. */
const stageOf = (line) => (/is writing/.test(line) ? "write" : /Testing/.test(line) ? "test" : /reviewer|runs with no errors/.test(line) ? "review" : null);

function showProgress({ lines, started }, finished = false) {
  let stage = "write";
  for (const line of lines) stage = stageOf(line) ?? stage;
  if (finished) stage = "done";
  const order = ["write", "test", "review", "done"];
  for (const item of document.querySelectorAll(".stages li")) {
    const index = order.indexOf(item.dataset.stage);
    item.className = index < order.indexOf(stage) ? "done" : index === order.indexOf(stage) ? "now" : "";
  }
  $("making-log").innerHTML = lines
    .slice(-14)
    .map((line) => line.replace(/^version (\d+): /, "v$1 · "))
    .map((line) => `<div class="${line.includes("Meta's AI in the game") ? "ai" : ""}">${escapeHtml(line.replace("Meta's AI in the game: ", "Meta's AI in the game → "))}</div>`)
    .join("");
  $("making-log").scrollTop = $("making-log").scrollHeight;
  const seconds = Math.round((Date.now() - started) / 1000);
  $("making-time").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} so far · usually about a minute`;
}

/** Asks the server to make a game. It writes, tests and fixes, so it takes a minute or more. */
async function make(heard = "") {
  const prompt = $("prompt").value.trim();
  if (!prompt) return say("Describe a game first, or press Speak.", true);
  $("make").disabled = $("speak").disabled = true;
  $("making").hidden = false;
  $("making-prompt").textContent = `${heard}“${prompt}”`;
  const started = Date.now();
  showProgress({ lines: [], started });
  const poll = setInterval(async () => {
    const progress = await (await fetch("/api/make/progress")).json().catch(() => null);
    if (progress?.started >= started - 5000) showProgress(progress);
  }, 1200);
  try {
    const response = await fetch("/api/make", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    clearInterval(poll);
    showProgress({ ...(await (await fetch("/api/make/progress")).json()), started }, true);
    const left = result.problems?.length ? ` It still has ${result.problems.length} problem(s), shown over the game.` : "";
    say(`Made “${result.title}” in ${result.tries} ${result.tries === 1 ? "version" : "versions"} for $${result.usd.toFixed(2)}.${left}`);
    await new Promise((done) => setTimeout(done, 900));
    $("making").hidden = true;
    await refresh(result.id);
  } catch (error) {
    $("making").hidden = true;
    say(error.message, true);
  } finally {
    clearInterval(poll);
    $("make").disabled = $("speak").disabled = false;
  }
}
$("make").addEventListener("click", () => make());
$("prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) make();
});

let recording = null;
$("speak").addEventListener("click", async () => {
  if (recording) return recording.stop();
  const button = $("speak");
  const caption = button.querySelector("span");
  recording = startRecording({ onLevel: (level) => button.style.setProperty("--level", Math.min(1, level * 12).toFixed(2)) });
  button.classList.add("listening");
  caption.textContent = "Stop";
  $("make").disabled = true;
  say("Listening… say any game you want. I stop when you pause.");
  try {
    const { wav, spoke } = await recording.done;
    button.classList.remove("listening");
    caption.textContent = "Speak";
    if (!spoke) throw new Error("I didn't hear anything. Check the microphone and try again.");
    say("Meta's Muse Voice is writing down what you said…");
    const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (!result.text) throw new Error("I couldn't make out any words. Try again, a little closer to the microphone.");
    $("prompt").value = result.text;
    recording = null;
    await make(`Heard: `);
  } catch (error) {
    const blocked = error.name === "NotAllowedError" ? "The browser blocked the microphone. Allow it next to the address bar and try again." : null;
    say(blocked ?? (error.name === "NotFoundError" ? "No microphone was found." : error.message), true);
  } finally {
    recording = null;
    button.classList.remove("listening");
    button.style.setProperty("--level", 0);
    caption.textContent = "Speak";
    $("make").disabled = false;
  }
});

await refresh(params.get("game"));
