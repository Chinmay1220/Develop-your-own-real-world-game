// No Engine: say any world and play it. The server's world model (Muse Spark) decides every move and
// Muse Image paints every frame; this page only shows the frames and passes on what you do.
import { startRecording } from "./voice.js";

const $ = (id) => document.getElementById(id);
let world = null;
let busy = false;
let front = $("frame-a");
let back = $("frame-b");

// While the AI works ----------------------------------------------------------------------------
let tick = null;
function working(text) {
  clearInterval(tick);
  $("shimmer").classList.toggle("on", Boolean(text));
  $("working").hidden = !text;
  if (!text) return;
  const started = Date.now();
  const show = () => ($("working").textContent = `${text} ${Math.round((Date.now() - started) / 1000)} s`);
  show();
  tick = setInterval(show, 500);
}

async function call(path, body) {
  const response = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Something went wrong");
  return result;
}

/** Fades in a frame once it is painted (the server answers when the painter is done). */
function showFrame(move) {
  return new Promise((done) => {
    const picture = new Image();
    picture.onload = picture.onerror = () => {
      back.src = picture.src;
      back.classList.add("shown");
      front.classList.remove("shown");
      [front, back] = [back, front];
      done();
    };
    picture.src = move.image;
  });
}

// Showing the world -----------------------------------------------------------------------------
function fill(list, items) {
  $(list).replaceChildren(...items.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
}

function render() {
  $("top").hidden = $("bottom").hidden = false;
  $("round").textContent = `Round ${world.round}`;
  $("name").textContent = world.title;
  $("goal").textContent = world.goal;
  fill("facts", world.facts);
  fill("characters", world.characters.map((character) => `${character.name}: ${character.about}`));
  $("moments").replaceChildren(
    ...world.moves
      .filter((move) => move.painted !== "painting")
      .map((move) => {
        const item = document.createElement("button");
        item.innerHTML = `<img alt="">`;
        item.querySelector("img").src = move.image;
        item.append(move.action ? `You: ${move.action}` : "The beginning");
        item.title = move.story;
        item.addEventListener("click", () => showFrame(move).then(() => ($("story").textContent = move.story)));
        return item;
      })
      .reverse(),
  );
  const firstMove = world.moves.length === 1;
  $("remembered").hidden = !(firstMove && world.remembered.length);
  if (firstMove && world.remembered.length) {
    $("remembered").innerHTML = `<b></b><ul></ul>`;
    $("remembered").querySelector("b").textContent = `Round ${world.round}: they remember you. ${world.learned}`;
    $("remembered").querySelector("ul").replaceChildren(...world.remembered.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
  }
}

function timing() {
  const move = world.moves.at(-1);
  const painted = move.paintSeconds == null ? "" : ` · Muse Image painted it in ${move.paintSeconds} s${move.painted === "failed" ? " (it couldn't draw this moment, so the last frame stays)" : ""}`;
  $("timing").textContent = `Muse Spark decided in ${move.thinkSeconds} s${painted}`;
}

/** After a frame arrives: the painting times, and the end of the round if it came. */
async function settle() {
  world = await call(`/api/paint/${encodeURIComponent(world.id)}`);
  render();
  timing();
  if (world.status !== "playing") showEnd();
  else $("action").focus();
}

// Playing ---------------------------------------------------------------------------------------
async function begin(prompt) {
  $("status").className = "";
  $("status").textContent = "Muse Spark is imagining your world…";
  $("create").disabled = $("speak-world").disabled = true;
  try {
    world = await call("/api/paint/start", { prompt });
    enter();
  } catch (error) {
    $("status").className = "error";
    $("status").textContent = error.message;
  } finally {
    $("create").disabled = $("speak-world").disabled = false;
  }
}

/** Shows a new world (or a new round) and waits for its first frame. */
async function enter() {
  history.replaceState(null, "", `?world=${encodeURIComponent(world.id)}`);
  $("start").hidden = $("end").hidden = true;
  render();
  $("story").textContent = world.moves[0].story;
  $("timing").textContent = "";
  setBusy(true);
  working("Muse Image is painting the world…");
  await showFrame(world.moves[0]);
  working(null);
  setBusy(false);
  await settle();
}

async function act(text) {
  text = text.trim();
  if (!text || busy || !world) return;
  setBusy(true);
  $("action").value = "";
  $("remembered").hidden = true;
  $("story").textContent = `You: ${text}`;
  working("Muse Spark is deciding what happens…");
  try {
    world = await call("/api/paint/act", { id: world.id, text });
    const move = world.moves.at(-1);
    $("story").textContent = move.story;
    render();
    timing();
    working("Muse Image is painting it…");
    await showFrame(move);
    working(null);
    await settle();
  } catch (error) {
    working(null);
    $("story").textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function setBusy(on) {
  busy = on;
  $("go").disabled = $("speak-act").disabled = on;
}

function showEnd() {
  const last = world.moves.at(-1);
  $("end-image").src = last.image;
  $("end-title").textContent = world.status === "won" ? "You won!" : "Round over";
  $("end-story").textContent = last.story;
  $("end-learned").hidden = true;
  $("end-status").textContent = "";
  $("again").disabled = false;
  $("top").hidden = $("bottom").hidden = $("panel").hidden = true; // so the game's own text doesn't show through
  $("end").hidden = false;
}

$("again").addEventListener("click", async () => {
  $("again").disabled = true;
  $("end-status").textContent = "Muse Wonder is studying how you played, so the characters remember you…";
  try {
    world = await call("/api/paint/again", { id: world.id });
    $("end-learned").hidden = false;
    $("end-learned").textContent = world.learned;
    $("end-status").textContent = "Muse Spark is setting up the next round…";
    await enter();
  } catch (error) {
    $("end-status").textContent = error.message;
    $("again").disabled = false;
  }
});

function newWorld() {
  world = null;
  history.replaceState(null, "", location.pathname);
  $("end").hidden = $("panel").hidden = true;
  $("top").hidden = $("bottom").hidden = true;
  $("start").hidden = false;
  $("status").textContent = "";
  $("prompt").focus();
}
$("new-world").addEventListener("click", newWorld);
$("end-new").addEventListener("click", newWorld);
$("show-panel").addEventListener("click", () => ($("panel").hidden = !$("panel").hidden));

$("create").addEventListener("click", () => $("prompt").value.trim() && begin($("prompt").value.trim()));
$("prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) (event.preventDefault(), $("create").click());
});
for (const example of $("examples").querySelectorAll("button")) example.addEventListener("click", () => ($("prompt").value = example.textContent));
$("act").addEventListener("submit", (event) => {
  event.preventDefault();
  act($("action").value);
});
// Enter sends even where a key press doesn't submit the form (some keyboards and test browsers).
$("action").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  act($("action").value);
});

// Speaking --------------------------------------------------------------------------------------
async function listen(button) {
  const caption = button.querySelector("span");
  const recording = startRecording({ onLevel: (level) => button.style.setProperty("--level", Math.min(1, level * 12).toFixed(2)) });
  button.classList.add("listening");
  caption.textContent = "Listening…";
  button.onclick = () => recording.stop();
  try {
    const { wav, spoke } = await recording.done;
    if (!spoke) throw new Error("I didn't hear anything. Check the microphone, or type.");
    caption.textContent = "Writing…";
    const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (!result.text) throw new Error("I couldn't make out any words. Try again, a little closer to the microphone.");
    return result.text;
  } catch (error) {
    throw error.name === "NotAllowedError" ? new Error("The browser blocked the microphone. Allow it next to the address bar.") : error;
  } finally {
    button.onclick = null;
    button.classList.remove("listening");
    button.style.setProperty("--level", 0);
    caption.textContent = "Speak";
  }
}

$("speak-world").addEventListener("click", async () => {
  if ($("speak-world").classList.contains("listening")) return;
  try {
    const text = await listen($("speak-world"));
    $("prompt").value = text;
    begin(text);
  } catch (error) {
    $("status").className = "error";
    $("status").textContent = error.message;
  }
});

$("speak-act").addEventListener("click", async () => {
  if (busy || $("speak-act").classList.contains("listening")) return;
  try {
    const text = await listen($("speak-act"));
    $("action").value = text;
    act(text);
  } catch (error) {
    $("story").textContent = error.message;
  }
});

// A world in the address bar: play on where it was.
const saved = new URLSearchParams(location.search).get("world");
if (saved) {
  try {
    world = await call(`/api/paint/${encodeURIComponent(saved)}`);
    $("start").hidden = true;
    render();
    $("story").textContent = world.moves.at(-1).story;
    await showFrame(world.moves.at(-1));
    timing();
    if (world.status !== "playing") showEnd();
  } catch {
    newWorld();
  }
} else $("prompt").focus();
