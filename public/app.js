// Browser side of Home Heist: draws the map and sends the player's actions to the server.
// All game logic lives on the server; this file only shows the view it sends back.
const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const RESULTS = { escaped: "Escaped", caught: "Caught", timeout: "Time up", playing: "Playing" };
const TOKEN_OFFSETS = [[[0, 0]], [[-3.2, 0], [3.2, 0]], [[-3.4, -1.8], [3.4, -1.8], [0, 3]]];

let view = null;
let busy = false;

async function api(path, body) {
  const options = body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? response.statusText);
  return data;
}

/** Sends a request, shows the new view, and reports whether it worked. */
async function run(path, body) {
  if (busy) return false;
  busy = true;
  updateControls();
  $("error").textContent = "";
  try {
    render(await api(path, body));
    return true;
  } catch (error) {
    $("error").textContent = error.message;
    return false;
  } finally {
    busy = false;
    updateControls();
  }
}

const act = (action) => run("/api/action", action);

function render(next) {
  view = next;
  renderHeader();
  renderMap();
  renderLog();
  renderActions();
  renderReport();
  renderNotebook();
}

function updateControls() {
  const playing = view?.status === "playing";
  for (const control of document.querySelectorAll("#actions button, #actions select, #free-text, #free-submit")) {
    control.disabled = busy || !playing;
  }
  for (const control of document.querySelectorAll("#restart, #wipe, #next-round")) control.disabled = busy;
  document.body.classList.toggle("busy", busy);
  $("thinking").hidden = !busy;
}

// ---------------------------------------------------------------------------
// Header

function renderHeader() {
  const chips = $("chips");
  chips.replaceChildren(
    chip(`Round <strong>${view.round}</strong>`),
    chip(`Step <strong>${view.step}</strong> / ${view.maxSteps}`),
    chip(view.lit ? "Lights on" : "<strong>Dark</strong>", view.lit ? "" : "dark"),
    chip(view.mode === "meta" ? "Meta Model API" : "Offline stand-in AI", view.mode === "meta" ? "meta" : ""),
  );
  if (view.usage) chips.append(chip(`<strong>$${view.usage.usd.toFixed(3)}</strong> spent · ${view.usage.calls} calls`));
  $("restart").textContent = view.status === "playing" ? "Restart round" : "Next round";
  $("room-name").textContent = view.room.name;
  $("room-desc").textContent = view.room.description;
  $("mode-note").textContent =
    view.mode === "meta"
      ? `AI: ${view.models.world} decides what happens and drives the guards; ${view.models.teacher} is the teacher.`
      : "AI: offline stand-ins that follow simple rules. Put MODEL_API_KEY in .env and restart to use Meta's models.";
}

function chip(html, extraClass = "") {
  const element = document.createElement("span");
  element.className = `chip ${extraClass}`.trim();
  element.innerHTML = html; // only ever built from numbers and fixed text above
  return element;
}

// ---------------------------------------------------------------------------
// Map

function renderMap() {
  const svg = $("map");
  svg.replaceChildren();
  svg.classList.toggle("dark", !view.lit);
  const zones = Object.fromEntries(view.zones.map((zone) => [zone.id, zone]));
  const thief = view.agents.find((agent) => agent.role === "thief");
  const watched = new Set(Object.values(view.vision).flat());
  const reachable = new Set(view.status === "playing" ? zones[thief.zone].neighbors : []);

  svg.append(svgNode("rect", { x: 1, y: 1, width: 98, height: 110, rx: 4, class: "floor" }));

  const drawn = new Set();
  for (const zone of view.zones) {
    for (const id of zone.neighbors) {
      const key = [zone.id, id].sort().join("|");
      if (drawn.has(key)) continue;
      drawn.add(key);
      svg.append(svgNode("line", { x1: zone.x, y1: zone.y, x2: zones[id].x, y2: zones[id].y, class: "path" }));
    }
  }

  for (const zone of view.zones) {
    const classes = ["zone", watched.has(zone.id) && "watched", zone.exit && "exit", reachable.has(zone.id) && "reachable"].filter(Boolean);
    const group = svgNode("g", { class: classes.join(" ") });
    group.append(svgNode("circle", { cx: zone.x, cy: zone.y, r: 7 }));
    if (zone.exit) group.append(svgNode("text", { x: zone.x, y: zone.y - 8.6, class: "exit-label" }, "EXIT"));
    const label = zone.name.replace(/^the /, "");
    group.append(svgNode("text", { x: zone.x, y: zone.y + 10.8, class: "zone-name" }, label));
    const items = view.objects.filter((object) => object.zone === zone.id && object.name !== label);
    items.forEach((object, index) => {
      group.append(svgNode("text", { x: zone.x, y: zone.y + 14.2 + index * 3, class: object.target ? "item target" : "item" }, itemLabel(object)));
    });
    if (reachable.has(zone.id)) makeClickable(group, `Move to ${zone.name}`, { kind: "move", target: zone.id });
    svg.append(group);
  }

  const byZone = new Map();
  for (const agent of view.agents) byZone.set(agent.zone, [...(byZone.get(agent.zone) ?? []), agent]);
  for (const [zoneId, agents] of byZone) {
    const zone = zones[zoneId];
    const offsets = TOKEN_OFFSETS[Math.min(agents.length, 3) - 1];
    agents.forEach((agent, index) => {
      const [dx, dy] = offsets[index] ?? [0, 0];
      const isThief = agent.role === "thief";
      const group = svgNode("g", {
        class: isThief ? `token thief${agent.hidden ? " hidden" : ""}` : "token guard",
        transform: `translate(${zone.x + dx} ${zone.y + dy})`,
      });
      group.append(svgNode("circle", { r: 3.1 }));
      group.append(svgNode("text", { y: 0.8, class: "token-label" }, isThief ? "You" : agent.name.replace(/^Guard /, "")));
      const duty = agent.duty === "target" ? "protects the target" : "watches the exit";
      group.append(svgNode("title", {}, isThief ? (agent.hidden ? "You (hidden)" : "You") : `${agent.name}, ${duty}`));
      svg.append(group);
    });
  }
}

function makeClickable(group, label, action) {
  group.setAttribute("tabindex", "0");
  group.setAttribute("role", "button");
  group.setAttribute("aria-label", label);
  group.addEventListener("click", () => act(action));
  group.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    act(action);
  });
}

function itemLabel(object) {
  let label = object.target ? `★ ${object.name}` : object.name;
  if (object.lightSource) label += object.on ? " (on)" : " (off)";
  if (object.broken) label += " (broken)";
  return label;
}

function svgNode(tag, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

// ---------------------------------------------------------------------------
// Story log

function renderLog() {
  const list = $("log");
  list.replaceChildren();
  if (view.log.length === 0) {
    const target = view.objects.find((object) => object.target)?.name ?? "target";
    list.append(
      element("li", "intro", `Get the ★ ${target} out through an exit without being caught. Red zones are where a guard can see you. Click a highlighted zone to move, or type any action below.`),
    );
  }
  for (const entry of view.log) {
    const item = element("li");
    item.append(element("div", "log-head", `Step ${entry.step} · you: ${entry.action}`));
    for (const line of entry.lines) item.append(element("p", lineClass(line), line));
    list.append(item);
  }
  list.scrollTop = list.scrollHeight;
}

function lineClass(line) {
  if (/catches you|finds you|Time is up/.test(line)) return "bad";
  if (/You escaped/.test(line)) return "good";
  if (/notebook says|but you can't/.test(line)) return "learned";
  if (/Checker blocked|call failed/.test(line)) return "warn";
  return "";
}

function element(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------
// Actions

function renderActions() {
  const box = $("actions");
  box.replaceChildren();
  const options = view.options;
  if (!options) return;

  const group = (title) => {
    const section = element("div", "action-group");
    const row = element("div", "buttons");
    section.append(element("h3", "", title), row);
    box.append(section);
    return row;
  };
  const button = (row, label, action, className = "") => {
    const node = element("button", className, label);
    node.type = "button";
    node.addEventListener("click", () => act(action));
    row.append(node);
  };

  const moves = group("Move");
  for (const zone of options.move) button(moves, `→ ${zone.name.replace(/^the /, "")}`, { kind: "move", target: zone.id });

  const here = group("Here");
  if (options.canUnhide) button(here, "Come out of hiding", { kind: "unhide" });
  for (const object of options.take) button(here, `Take the ${object.name}`, { kind: "take", target: object.id });
  for (const spot of options.hide) button(here, `Hide ${spot.phrase}`, { kind: "hide", target: spot.id });
  for (const object of options.use) button(here, `Switch the ${object.name} ${object.on ? "off" : "on"}`, { kind: "use", target: object.id });
  button(here, "Wait", { kind: "wait" }, "ghost");

  if (options.held.length > 0 && options.throwTargets.length > 0) {
    const row = group("Throw");
    const item = select(options.held.map((object) => [object.id, `the ${object.name}`]), "Item to throw");
    const target = select(options.throwTargets.map((zone) => [zone.id, `at ${zone.name}`]), "Where to throw it");
    const go = element("button", "", "Throw");
    go.type = "button";
    go.addEventListener("click", () => act({ kind: "throw", item: item.value, target: target.value }));
    row.append(item, target, go);
  }

  const held = options.held.map((object) => object.name);
  box.append(element("p", "carrying", held.length > 0 ? `You carry: ${held.join(", ")}` : "Your hands are empty."));
}

function select(choices, label) {
  const node = element("select");
  node.setAttribute("aria-label", label);
  for (const [value, text] of choices) {
    const option = element("option", "", text);
    option.value = value;
    node.append(option);
  }
  return node;
}

// ---------------------------------------------------------------------------
// End-of-round report

function renderReport() {
  const box = $("report");
  const report = view.report;
  box.hidden = !report;
  box.replaceChildren();
  if (!report) return;

  const won = report.status === "escaped";
  box.append(element("h2", won ? "good" : "bad", { escaped: "You escaped!", caught: "Caught!", timeout: "Time is up" }[report.status]));
  box.append(element("p", "", `Round ${report.round} took ${report.steps} steps.`));

  box.append(element("h3", "", "What the guards learned"));
  box.append(
    report.newGuardLessons.length > 0
      ? list(report.newGuardLessons.map((lesson) => lesson.text))
      : element("p", "", won ? "Nothing they didn't already know." : "Nothing new. They won, so their notebook stays the same."),
  );

  box.append(element("h3", "", "What the world model learned"));
  box.append(
    report.mistakes.length > 0
      ? list(report.mistakes.map((mistake) => `Step ${mistake.step}: ${mistake.problem}`))
      : element("p", "", "The teacher found no mistakes this round."),
  );

  if (report.warnings.length > 0) {
    box.append(element("h3", "", "Warnings"));
    box.append(list(report.warnings));
  }

  const next = element("button", "primary", `Play round ${report.round + 1}`);
  next.type = "button";
  next.id = "next-round";
  next.addEventListener("click", () => run("/api/round", {}));
  box.append(next);
}

function list(lines) {
  const node = element("ul");
  for (const line of lines) node.append(element("li", "", line));
  return node;
}

// ---------------------------------------------------------------------------
// Notebook

function renderNotebook() {
  fillLessons($("guard-lessons"), view.notebook.guardLessons, "Empty. The guards learn from every round they lose.");
  fillLessons($("world-lessons"), view.notebook.worldLessons, "Empty. The teacher adds a correction when the world model gets the room wrong.");
  const body = $("history");
  body.replaceChildren();
  for (const row of view.notebook.history) {
    const tr = element("tr");
    tr.append(element("td", "", String(row.round)), element("td", row.status, RESULTS[row.status]), element("td", "", String(row.steps)), element("td", "", String(row.worldMistakes)));
    body.append(tr);
  }
  if (view.notebook.history.length === 0) {
    const tr = element("tr");
    const td = element("td", "", "No finished rounds yet.");
    td.colSpan = 4;
    tr.append(td);
    body.append(tr);
  }
}

function fillLessons(target, lessons, emptyText) {
  target.replaceChildren();
  if (lessons.length === 0) target.append(element("li", "empty", emptyText));
  for (const lesson of lessons) {
    const item = element("li");
    item.append(element("span", "round", `Round ${lesson.round}`), document.createTextNode(lesson.text));
    target.append(item);
  }
}

// ---------------------------------------------------------------------------
// Wiring

$("free-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("free-text").value.trim();
  if (!text) return;
  if (await act({ kind: "free", text })) $("free-text").value = "";
});
$("restart").addEventListener("click", () => run("/api/round", {}));
$("wipe").addEventListener("click", () => {
  if (confirm("Forget everything the guards and the world model have learned?")) run("/api/reset", {});
});

api("/api/state")
  .then((data) => {
    render(data);
    updateControls();
  })
  .catch((error) => {
    $("error").textContent = `Could not reach the game server: ${error.message}`;
  });
