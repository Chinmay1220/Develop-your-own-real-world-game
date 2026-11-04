// The game maker: type what you want, Meta's designer model makes the level, and it appears in 3D.
// Playing designed levels comes next; for now hunters stand guard and patrols walk their routes.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadCharacters, makeCharacter, play } from "./characters.js";
import { buildLevel, label } from "./level-builder.js";
import { startRecording } from "./voice.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const HALF_ANGLE = 0.55; // half of a hunter's field of view, as in the 3D game

const renderer = new THREE.WebGLRenderer({ canvas: $("scene"), antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f17);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = 1.25;
controls.minZoom = 0.6;
controls.maxZoom = 5;

let level = null;
let room = null;
let people = [];

/** Fits the whole building on screen, to the right of the panel. */
function frame() {
  const { x0, x1, z0, z1 } = level.bounds;
  const target = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
  camera.position.copy(target).addScaledVector(new THREE.Vector3(-1, 1.3, 1).normalize(), 70);
  camera.lookAt(target);
  camera.zoom = 1;
  controls.target.copy(target);
  camera.updateMatrixWorld();
  const view = new THREE.Box3();
  for (const x of [x0, x1]) for (const z of [z0, z1]) for (const y of [0, 3]) view.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
  const panel = window.innerWidth > 900 ? 400 : 0;
  const aspect = window.innerWidth / window.innerHeight;
  const share = (window.innerWidth - panel) / window.innerWidth;
  const half = Math.max((view.max.y - view.min.y) / 2, (view.max.x - view.min.x) / 2 / (aspect * share)) * 1.1;
  const screenCenter = ((panel + (window.innerWidth - panel) / 2) / window.innerWidth) * 2 - 1;
  const middle = (view.min.x + view.max.x) / 2 - screenCenter * half * aspect;
  Object.assign(camera, { left: middle - half * aspect, right: middle + half * aspect, top: (view.min.y + view.max.y) / 2 + half, bottom: (view.min.y + view.max.y) / 2 - half });
  camera.updateProjectionMatrix();
}

/** A close look at one character, for screenshots: `half` is half the height of the view in metres. */
function focus(agentId, half = 4) {
  const walker = people.find((entry) => entry.agent.id === agentId) ?? people[0];
  const target = walker.person.root.position.clone();
  camera.position.copy(target).addScaledVector(new THREE.Vector3(-1, 1.3, 1).normalize(), 70);
  camera.lookAt(target);
  controls.target.copy(target);
  const panel = window.innerWidth > 900 ? 400 : 0;
  const aspect = window.innerWidth / window.innerHeight;
  const middle = -(((panel + (window.innerWidth - panel) / 2) / window.innerWidth) * 2 - 1) * half * aspect;
  Object.assign(camera, { zoom: 1, left: middle - half * aspect, right: middle + half * aspect, top: half, bottom: -half });
  camera.updateProjectionMatrix();
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (level) frame();
}
window.addEventListener("resize", resize);

/** The zones to walk through from one zone to another. */
function zonePath(from, to) {
  const parent = new Map([[from, from]]);
  const queue = [from];
  while (queue.length) {
    const zone = queue.shift();
    if (zone === to) break;
    for (const next of room.zones.find((z) => z.id === zone)?.neighbors ?? []) {
      if (!parent.has(next)) parent.set(next, zone), queue.push(next);
    }
  }
  const path = [to];
  while (path[0] !== from && parent.has(path[0])) path.unshift(parent.get(path[0]));
  return path[0] === from ? path : [from];
}

/** For a patrol: door by door through each room of the route, pausing in each one. */
function patrolPoints(agent) {
  const route = agent.route ?? [];
  if (route.length < 2) return null;
  const points = [];
  for (let i = 0; i < route.length; i++) {
    const path = zonePath(route[i], route[(i + 1) % route.length]);
    for (let k = 1; k < path.length; k++) {
      const door = level.doorBetween(path[k - 1], path[k]);
      if (door) points.push({ x: door.x, z: door.z, pause: 0 });
      points.push({ ...level.spot(path[k], 2), pause: k === path.length - 1 ? 1.5 : 0 });
    }
  }
  return points;
}

function visionCone() {
  const cone = new THREE.Mesh(
    new THREE.CircleGeometry(3, 24, -Math.PI / 2 - HALF_ANGLE, 2 * HALF_ANGLE),
    new THREE.MeshBasicMaterial({ color: 0xff5a4f, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  );
  cone.rotation.x = -Math.PI / 2; // lies flat and points the way the hunter faces
  cone.position.y = 0.03;
  return cone;
}

async function placeCharacters() {
  const models = await loadCharacters().catch((error) => {
    console.error(error);
    return null;
  });
  if (!models || !level) return;
  for (const agent of room.agents) {
    const thief = agent.role === "thief";
    const person = makeCharacter(agent.look ?? (thief ? "thief" : "guard"), agent.color);
    const sharing = room.agents.filter((other) => other.zone === agent.zone);
    const spot = level.spot(agent.zone, sharing.indexOf(agent) * 4);
    const zone = level.zones.get(agent.zone);
    person.root.position.set(spot.x, 0, spot.z);
    person.root.rotation.y = Math.atan2(zone.cx - spot.x, zone.cz - spot.z) || Math.PI / 4;
    const tag = label(thief ? "You" : agent.name, { color: thief ? "#f5b942" : "#ff8a7a", size: 0.75 });
    tag.position.y = person.height + 0.5;
    person.root.add(tag);
    if (!thief) person.root.add(visionCone());
    level.root.add(person.root);
    people.push({ person, agent, points: thief ? null : patrolPoints(agent), leg: 0, pause: 0 });
  }
}

const RADIUS = 0.26; // how close characters get to furniture, as in the 3D game
const blocked = (x, z) => level.obstacles.some(([x0, z0, x1, z1]) => x > x0 - RADIUS && x < x1 + RADIUS && z > z0 - RADIUS && z < z1 + RADIUS);

function walkPatrols(dt) {
  for (const walker of people) {
    if (!walker.points) continue;
    const body = walker.person.root;
    if (walker.pause > 0) {
      walker.pause -= dt;
      play(walker.person, "idle");
      continue;
    }
    const goal = walker.points[walker.leg % walker.points.length];
    const dx = goal.x - body.position.x;
    const dz = goal.z - body.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.08 || walker.stuck > 1) {
      walker.leg += 1;
      walker.pause = goal.pause;
      walker.stuck = 0;
      continue;
    }
    // Step toward the goal, sliding along furniture; skip the point if stuck for a second.
    const step = Math.min(distance, 1.2 * dt);
    const nx = body.position.x + (dx / distance) * step;
    const nz = body.position.z + (dz / distance) * step;
    if (!blocked(nx, nz)) body.position.set(nx, 0, nz);
    else if (!blocked(nx, body.position.z)) body.position.x = nx;
    else if (!blocked(body.position.x, nz)) body.position.z = nz;
    else walker.stuck = (walker.stuck ?? 0) + dt;
    const turn = Math.atan2(dx, dz) - body.rotation.y;
    body.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 8);
    play(walker.person, "walk");
  }
}

// ---------------------------------------------------------------------------
// The panel

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

function describe() {
  const target = room.objects.find((object) => object.id === room.targetId);
  const hunters = room.agents.filter((agent) => agent.role === "guard");
  const duty = (agent) => (agent.duty === "patrol" ? "patrols" : agent.duty === "target" ? `guards the ${target?.name}` : "watches an exit");
  $("level").innerHTML = `
    <h2>${escapeHtml(room.name)}</h2>
    ${room.prompt ? `<p class="prompt">Made from: “${escapeHtml(room.prompt)}”</p>` : ""}
    ${room.note ? `<p class="note">${escapeHtml(room.note)}</p>` : ""}
    ${room.missing?.length ? `<p class="note">Couldn't show: ${escapeHtml(room.missing.join("; "))}</p>` : ""}
    <p>${escapeHtml(room.story ?? room.description)}</p>
    <ul>
      <li>Steal: <b>${escapeHtml(target?.name ?? "?")}</b></li>
      ${hunters.map((agent) => `<li>${escapeHtml(agent.name)}: ${escapeHtml(duty(agent))}</li>`).join("")}
      <li>${room.zones.length} rooms, ${room.objects.length} things, ${room.maxSteps} steps</li>
    </ul>
    ${level.missing.length ? `<p class="note">Did not fit in the 3D rooms: ${escapeHtml(level.missing.join(", "))}.</p>` : ""}`;
}

async function refreshList(selected) {
  const levels = await (await fetch("/api/levels")).json();
  $("levels").innerHTML = levels.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`).join("");
  if (levels.length === 0) $("level").innerHTML = "<p>Describe a game above to make your first level.</p>";
  const id = selected ?? levels[0]?.id;
  if (id) $("levels").value = id;
  return id;
}

async function show(id) {
  const response = await fetch(`/api/levels/${encodeURIComponent(id)}`);
  if (!response.ok) return;
  room = await response.json();
  if (level) scene.remove(level.root);
  people = [];
  level = buildLevel(room, catalog, { cutaway: true });
  scene.add(level.root);
  frame();
  describe();
  history.replaceState(null, "", `?level=${encodeURIComponent(id)}`);
  await placeCharacters();
}

$("levels").addEventListener("change", () => show($("levels").value));

function say(text, error = false) {
  $("status").className = error ? "error" : "";
  $("status").textContent = text;
}

/** Designs a level from the words in the box. `heard` is shown first when the words were spoken. */
async function design(heard = "") {
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  $("design").disabled = $("speak").disabled = true;
  say(`${heard}Muse Spark is designing your level. This takes about half a minute…`);
  try {
    const response = await fetch("/api/design", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    say(`${heard}Designed in ${result.tries} ${result.tries === 1 ? "try" : "tries"}${result.usd ? `, for $${result.usd.toFixed(3)}` : ""}.`);
    await show(await refreshList(result.id));
  } catch (error) {
    say(error.message, true);
  } finally {
    $("design").disabled = $("speak").disabled = false;
  }
}

$("design").addEventListener("click", () => design());

// Speak instead of typing: record until the player pauses, turn the words into text with Meta's
// speech-to-text model, then design straight away.
let recording = null;
$("speak").addEventListener("click", async () => {
  if (recording) return recording.stop(); // a second click stops early
  const button = $("speak");
  const caption = button.querySelector("span");
  recording = startRecording({ onLevel: (level) => button.style.setProperty("--level", Math.min(1, level * 12).toFixed(2)) });
  button.classList.add("listening");
  caption.textContent = "Stop";
  $("design").disabled = true;
  say("Listening… say the game you want. I stop when you pause.");
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
    await design(`Heard: “${result.text}” `);
  } catch (error) {
    const blocked = error.name === "NotAllowedError" ? "The browser blocked the microphone. Allow it next to the address bar and try again." : null;
    const missing = error.name === "NotFoundError" ? "No microphone was found." : null;
    say(blocked ?? missing ?? error.message, true);
  } finally {
    recording = null;
    button.classList.remove("listening");
    button.style.setProperty("--level", 0);
    caption.textContent = "Speak";
    $("design").disabled = false;
  }
});

// ---------------------------------------------------------------------------

const catalog = await (await fetch("/api/catalog")).json();
resize();
const first = await refreshList(params.get("level"));
if (first) await show(first);
if (params.has("debug")) window.maker = { level, room, people, camera, focus };

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  for (const { person } of people) person.mixer.update(dt);
  walkPatrols(dt);
  if (level?.targetRing) level.targetRing.rotation.z += dt * 1.5;
  controls.update();
  renderer.render(scene, camera);
});
