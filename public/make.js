// Speak any game: say or type an idea, the server has Meta's model write the game, tests it in a hidden
// browser and fixes errors, then the game plays here in a sealed frame. While it plays, the panel on
// the left shows what Meta's AI decides inside the game, and what it learns after each round.
import { runGame } from "./sandbox.js";
import { startRecording } from "./voice.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const catalog = await (await fetch("/api/catalog")).json();
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
let current = null;
let playing = null; // the game on screen

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
  const what =
    error ? `failed: ${error}`
    : call.kind === "act" ? `“${call.text}” → ${result.story}`
    : call.kind === "think" ? `${result.thought}${result.say ? ` “${result.say}”` : ""}`
    : `Muse Wonder learned: ${result.summary}`;
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

$("forget").addEventListener("click", async () => {
  if (!playing) return;
  await fetch("/api/live/forget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game: playing.id }) });
  await showLessons(playing);
  say("Meta's AI forgot what it learned in this game. The next round starts fresh.");
});

function say(text, error = false) {
  $("status").className = error ? "error" : "";
  $("status").textContent = text;
}

async function refresh(selected) {
  const games = await (await fetch("/api/games")).json();
  $("games").innerHTML = games
    .filter((game) => game.model !== "none")
    .map((game) => `<button class="card" data-id="${escapeHtml(game.id)}"><b>${escapeHtml(game.title)}</b><span>${escapeHtml(game.pitch)}</span><i>“${escapeHtml(game.prompt)}”</i></button>`)
    .join("") || "<p>No games yet.</p>";
  for (const card of $("games").querySelectorAll(".card")) card.addEventListener("click", () => play(card.dataset.id));
  if (selected) play(selected);
}

async function play(id) {
  const response = await fetch(`/api/games/${encodeURIComponent(id)}`);
  if (!response.ok) return;
  const game = await response.json();
  current?.stop();
  $("empty").hidden = true;
  $("errors").textContent = "";
  for (const card of $("games").querySelectorAll(".card")) card.classList.toggle("selected", card.dataset.id === id);
  playing = game;
  $("ai-log").textContent = "";
  $("ai").hidden = !/kit\.(world|mind)\(/.test(game.code); // games made before the world model was added
  if (!$("ai").hidden) showLessons(game);
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

/** Asks the server to make a game. It writes, tests and fixes, so it takes a few minutes. */
async function make(heard = "") {
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  $("make").disabled = $("speak").disabled = true;
  const started = Date.now();
  const tick = setInterval(() => {
    const seconds = Math.round((Date.now() - started) / 1000);
    say(`${heard}Muse Wonder is writing your game, then a test browser plays it and any errors go back to be fixed. This takes a few minutes… (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")})`);
  }, 1000);
  try {
    const response = await fetch("/api/make", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    const left = result.problems?.length ? ` It still has ${result.problems.length} problem(s), shown over the game.` : "";
    say(`${heard}Made “${result.title}” in ${result.tries} ${result.tries === 1 ? "version" : "versions"} for $${result.usd.toFixed(2)}.${left} Click the game, then play.`);
    await refresh(result.id);
  } catch (error) {
    say(error.message, true);
  } finally {
    clearInterval(tick);
    $("make").disabled = $("speak").disabled = false;
  }
}

$("make").addEventListener("click", () => make());

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
    await make(`Heard: “${result.text}” `);
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
