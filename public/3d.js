// Home Heist in 3D: a playable prototype of the sample room, drawn with three.js.
// The guards follow simple rules here. In the full game, Meta's models decide what actions cause
// and drive the guards, as they already do in the 2D version.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const ROOM = 3.5; // the room is 7 m × 7 m, centred on the origin
const WALL = 2.6;
const T = 0.12; // wall thickness
const HALF_ANGLE = 0.55; // half of a guard's field of view, in radians
const FAN_RAYS = 28; // rays used to draw each guard's view on the floor
const RADIUS = 0.26; // how close characters get to furniture
const SPEED = { sneak: 0.9, walk: 1.5, run: 3.2 };
const CHARACTERS = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/";
const LAMP = { x: -3.15, z: -0.5 };
const LAMP_FRONT = [-2.62, -0.5];
const CLOSET_FRONT = [2.45, 0.3];
const LAPTOP_SPOT = { x: 2.35, z: -3.0 };

// ---------------------------------------------------------------------------
// Renderer, cameras and lights

const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f17);

// Two views: an isometric overview like Diablo II (what Agora-2 learned from), and a camera behind the thief.
const iso = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
iso.position.set(-9, 10, 9);
iso.lookAt(0, 0.5, 0);
const follow = new THREE.PerspectiveCamera(55, 1, 0.05, 60);
let camera = params.get("cam") === "iso" ? iso : follow;
const view = { yaw: 0.755 + Math.PI, pitch: 0.36, distance: 4.2, snap: true };

function resize() {
  const aspect = window.innerWidth / window.innerHeight;
  const half = Math.max(4.9, 5.8 / aspect); // keeps the whole room in view on narrow screens
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  Object.assign(iso, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
  iso.updateProjectionMatrix();
  follow.aspect = aspect;
  follow.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

scene.add(new THREE.HemisphereLight(0x8ea6ff, 0x20160f, 0.9));

const moon = new THREE.DirectionalLight(0x9bb8ff, 1.4); // shines in through the window
moon.position.set(-1.6, 5, -9);
moon.target.position.set(-1.8, 0, 0.6);
moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.normalBias = 0.02;
Object.assign(moon.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 25 });
moon.shadow.camera.updateProjectionMatrix();
scene.add(moon, moon.target);

const lampLight = new THREE.PointLight(0xffbf73, 1, 0, 2);
lampLight.power = 450;
lampLight.position.set(LAMP.x, 0.86, LAMP.z);
lampLight.castShadow = true;
lampLight.shadow.mapSize.set(1024, 1024);
lampLight.shadow.bias = -0.004;
lampLight.shadow.normalBias = 0.05;
scene.add(lampLight);

// ---------------------------------------------------------------------------
// Building blocks

const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...options });
const blockers = []; // things guards cannot see through
const obstacles = []; // floor footprints nobody can walk through: [minX, minZ, maxX, maxZ]
const walls = []; // full-height walls that turn see-through when they hide the thief

/** A box from its size, the centre of its footprint and the height of its bottom face. */
function box(w, h, d, mat, x, bottom, z, { blocksSight = false, blocksWalking = false, shadow = true, wall = false } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall ? mat.clone() : mat);
  mesh.position.set(x, bottom + h / 2, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (blocksSight) blockers.push(mesh);
  if (blocksWalking) obstacles.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
  if (wall) {
    mesh.material.transparent = true;
    walls.push(mesh);
  }
  return mesh;
}

function cylinder(top, bottom, height, mat, x, y, z, options = {}) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, 24, 1, options.open ?? false), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = options.shadow ?? true;
  scene.add(mesh);
  return mesh;
}

// A seeded random, so the room looks the same on every load.
let seed = 7;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function canvasTexture(size, draw, repeat = 1) {
  const surface = document.createElement("canvas");
  surface.width = surface.height = size;
  draw(surface.getContext("2d"), size);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  return texture;
}

// ---------------------------------------------------------------------------
// The room

const wallMat = material(0x8d8fa8);
const trimMat = material(0x4d5169);
const wood = material(0x8a5a36);
const woodDark = material(0x5a3b26);

box(7.7, 0.45, 7.7, material(0x161c29), 0, -0.45, 0, { shadow: false }); // the diorama base

const planks = canvasTexture(512, (g, size) => {
  const width = size / 8;
  for (let i = 0; i < 8; i++) {
    const shade = 0.85 + random() * 0.3;
    g.fillStyle = `rgb(${(122 * shade) | 0}, ${(86 * shade) | 0}, ${(58 * shade) | 0})`;
    g.fillRect(i * width, 0, width, size);
    g.fillStyle = "rgba(0, 0, 0, 0.35)";
    g.fillRect(i * width, 0, 2, size);
    g.fillRect(i * width, random() * size, width, 2);
  }
}, 2);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshStandardMaterial({ map: planks, roughness: 0.75 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Back walls (north and east) are full height; front walls (south and west) are cut low so you can see in.
const northZ = -ROOM - T / 2;
const win = { x0: -3.0, x1: -1.8, y0: 0.9, y1: 2.1 };
box(win.x0 + ROOM + T, WALL, T, wallMat, (-ROOM - T + win.x0) / 2, 0, northZ, { blocksSight: true, wall: true });
box(ROOM + T - win.x1, WALL, T, wallMat, (win.x1 + ROOM + T) / 2, 0, northZ, { blocksSight: true, wall: true });
box(win.x1 - win.x0, win.y0, T, wallMat, (win.x0 + win.x1) / 2, 0, northZ, { wall: true });
box(win.x1 - win.x0, WALL - win.y1, T, wallMat, (win.x0 + win.x1) / 2, win.y1, northZ, { wall: true });
const glass = new THREE.Mesh(
  new THREE.PlaneGeometry(win.x1 - win.x0, win.y1 - win.y0),
  new THREE.MeshStandardMaterial({ color: 0x0d1830, emissive: 0x29477f, emissiveIntensity: 0.9, transparent: true, opacity: 0.55 }),
);
glass.position.set((win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2, northZ + 0.01);
scene.add(glass);
box(0.04, win.y1 - win.y0, 0.06, trimMat, (win.x0 + win.x1) / 2, win.y0, northZ + 0.04);
box(win.x1 - win.x0, 0.04, 0.06, trimMat, (win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2, northZ + 0.04);
box(win.x1 - win.x0 + 0.2, 0.05, 0.18, trimMat, (win.x0 + win.x1) / 2, win.y0 - 0.05, northZ + 0.09);
for (const x of [win.x0 - 0.13, win.x1 + 0.13]) box(0.22, 2.3, 0.06, material(0x6a4a8c), x, 0.05, -ROOM + 0.08); // curtains

const eastX = ROOM + T / 2;
const bath = { z0: 2.15, z1: 3.05, top: 2.05 }; // the bathroom doorway
box(T, WALL, bath.z0 + ROOM + T, wallMat, eastX, 0, (-ROOM - T + bath.z0) / 2, { blocksSight: true, wall: true });
box(T, WALL, ROOM + T - bath.z1, wallMat, eastX, 0, (bath.z1 + ROOM + T) / 2, { blocksSight: true, wall: true });
box(T, WALL - bath.top, bath.z1 - bath.z0, wallMat, eastX, bath.top, (bath.z0 + bath.z1) / 2, { wall: true });
const darkness = new THREE.Mesh(new THREE.PlaneGeometry(bath.z1 - bath.z0, bath.top), new THREE.MeshBasicMaterial({ color: 0x05070b }));
darkness.position.set(eastX + 0.08, bath.top / 2, (bath.z0 + bath.z1) / 2);
darkness.rotation.y = -Math.PI / 2;
scene.add(darkness);
for (const z of [bath.z0, bath.z1]) box(0.14, bath.top, 0.07, trimMat, ROOM - 0.02, 0, z);
box(0.14, 0.07, bath.z1 - bath.z0 + 0.07, trimMat, ROOM - 0.02, bath.top, (bath.z0 + bath.z1) / 2);

const LOW = 0.4;
const southZ = ROOM + T / 2;
const door = { x0: -1.15, x1: -0.25, top: 2.1 };
box(door.x0 + ROOM + T, LOW, T, wallMat, (-ROOM - T + door.x0) / 2, 0, southZ);
box(ROOM + T - door.x1, LOW, T, wallMat, (door.x1 + ROOM + T) / 2, 0, southZ);
box(T, LOW, 7 + 2 * T, wallMat, -ROOM - T / 2, 0, 0);
for (const x of [door.x0, door.x1]) box(0.07, door.top, 0.14, trimMat, x, 0, southZ);
box(door.x1 - door.x0 + 0.07, 0.07, 0.14, trimMat, (door.x0 + door.x1) / 2, door.top, southZ);

function exitMarker(x, z, w, d) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0x48c487, transparent: true, opacity: 0.35, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.015, z);
  scene.add(mesh);
  return { mesh, x, z };
}
const exits = [exitMarker(-2.4, -3.05, 1.2, 0.6), exitMarker(-0.7, 3.1, 0.9, 0.6)];

// Bookshelf between the window and the desk: it blocks the view between them.
box(0.36, 2.0, 1.44, woodDark, 0.3, 0, -2.72, { blocksSight: true, blocksWalking: true });
const bookColors = [0xb84a3e, 0x3e6db8, 0xd9a441, 0x4f8a5b, 0x8d5fb8, 0xe0d6c2];
for (let level = 0; level < 4; level++) {
  for (let z = -3.36; z < -2.1; ) {
    const thick = 0.05 + random() * 0.06;
    const tall = 0.24 + random() * 0.14;
    box(0.04, tall, thick, material(bookColors[Math.floor(random() * bookColors.length)]), 0.1, 0.12 + level * 0.47, z + thick / 2, { shadow: false });
    z += thick + 0.008;
  }
}

// Desk, chair, laptop (the target) and mug.
box(1.5, 0.05, 0.75, wood, 2.45, 0.72, -3.08, { blocksWalking: true });
for (const [dx, dz] of [[-0.7, -0.32], [0.7, -0.32], [-0.7, 0.32], [0.7, 0.32]]) box(0.05, 0.72, 0.05, woodDark, 2.45 + dx, 0, -3.08 + dz);
box(0.45, 0.05, 0.45, woodDark, 2.3, 0.45, -2.35);
box(0.45, 0.5, 0.05, woodDark, 2.3, 0.5, -2.12);

const laptop = new THREE.Group();
const laptopBase = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, 0.25), material(0xc9ced8, { metalness: 0.6, roughness: 0.35 }));
const laptopScreen = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.012), new THREE.MeshStandardMaterial({ color: 0x0b1424, emissive: 0x5fa8ff, emissiveIntensity: 1.6 }));
laptopScreen.position.set(0, 0.12, -0.12);
laptopScreen.rotation.x = -0.28;
laptopBase.castShadow = laptopScreen.castShadow = true;
laptop.add(laptopBase, laptopScreen);
laptop.position.set(LAPTOP_SPOT.x, 0.78, LAPTOP_SPOT.z);
scene.add(laptop);
const targetRing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.018, 8, 48), new THREE.MeshBasicMaterial({ color: 0xf5b942 }));
targetRing.rotation.x = Math.PI / 2;
targetRing.position.set(LAPTOP_SPOT.x, 1.25, LAPTOP_SPOT.z);
scene.add(targetRing);
cylinder(0.05, 0.045, 0.11, material(0xe8e2d6), 2.95, 0.83, -3.15);

const rugPattern = canvasTexture(256, (g, size) => {
  g.fillStyle = "#6b2737";
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "#d9a441";
  g.lineWidth = 6;
  g.strokeRect(14, 14, size - 28, size - 28);
  const diamond = (inset, color) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(size / 2, inset);
    g.lineTo(size - inset, size / 2);
    g.lineTo(size / 2, size - inset);
    g.lineTo(inset, size / 2);
    g.closePath();
    g.fill();
  };
  diamond(40, "#2f5d62");
  diamond(80, "#d9a441");
  diamond(105, "#6b2737");
});
const rug = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.015, 1.9), new THREE.MeshStandardMaterial({ map: rugPattern, roughness: 0.95 }));
rug.position.set(-0.1, 0.008, -0.2);
rug.receiveShadow = true;
scene.add(rug);

// Bed with storage drawers underneath: there is no space to hide under it.
box(2.1, 0.38, 1.6, woodDark, -2.39, 0, 0.6, { blocksWalking: true });
for (const dx of [-0.5, 0.5]) {
  box(0.85, 0.22, 0.02, wood, -2.39 + dx, 0.07, 1.41);
  box(0.14, 0.03, 0.03, trimMat, -2.39 + dx, 0.17, 1.43);
}
box(2.0, 0.2, 1.52, material(0xe9e4d8), -2.39, 0.38, 0.6);
box(1.3, 0.07, 1.56, material(0x2f6f73), -1.95, 0.56, 0.6);
for (const dz of [-0.37, 0.37]) box(0.38, 0.12, 0.62, material(0xf4f1ea), -3.1, 0.58, 0.6 + dz);
box(0.08, 1.05, 1.66, woodDark, -3.42, 0, 0.6);

// Nightstand and the bedside lamp, the only light in the room.
box(0.42, 0.5, 0.42, wood, LAMP.x, 0, LAMP.z, { blocksWalking: true });
cylinder(0.07, 0.08, 0.04, material(0x2b2b2b), LAMP.x, 0.52, LAMP.z, { shadow: false });
cylinder(0.012, 0.012, 0.32, material(0x2b2b2b), LAMP.x, 0.68, LAMP.z, { shadow: false });
const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf3d9a8, emissive: 0xffb860, emissiveIntensity: 1.2, side: THREE.DoubleSide });
cylinder(0.1, 0.16, 0.2, shadeMat, LAMP.x, 0.9, LAMP.z, { open: true, shadow: false });

// Closet against the east wall: one person fits inside.
box(0.7, 2.1, 1.3, wood, 3.12, 0, 0.3, { blocksSight: true, blocksWalking: true });
box(0.01, 1.95, 0.012, woodDark, 2.765, 0.08, 0.3);
for (const dz of [-0.07, 0.07]) {
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), material(0xd9a441, { metalness: 0.7, roughness: 0.3 }));
  knob.position.set(2.75, 1.05, 0.3 + dz);
  scene.add(knob);
}

// ---------------------------------------------------------------------------
// Movement and senses

function blocked(x, z) {
  if (Math.abs(x) > ROOM - RADIUS || Math.abs(z) > ROOM - RADIUS) return true;
  return obstacles.some(([x0, z0, x1, z1]) => x > x0 - RADIUS && x < x1 + RADIUS && z > z0 - RADIUS && z < z1 + RADIUS);
}

const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

function turnToward(body, dx, dz, dt, rate = 10) {
  body.rotation.y += angleTo(body.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * rate);
}

/** Moves a character toward a point, sliding along furniture. Returns true once it has arrived or is stuck. */
function walk(body, x, z, speed, dt) {
  const dx = x - body.position.x;
  const dz = z - body.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.05) return true;
  const step = Math.min(distance, speed * dt);
  const nx = body.position.x + (dx / distance) * step;
  const nz = body.position.z + (dz / distance) * step;
  if (!blocked(nx, nz)) body.position.set(nx, 0, nz);
  else if (!blocked(nx, body.position.z)) body.position.x = nx;
  else if (!blocked(body.position.x, nz)) body.position.z = nz;
  else return true;
  turnToward(body, dx, dz, dt);
  return false;
}

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const raycaster = new THREE.Raycaster();
const eye = new THREE.Vector3();
const direction = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Game state, sound and effects

const game = {
  lampOn: params.get("lamp") !== "off",
  darkSince: 0,
  relightBy: null,
  shoeThrown: false,
  hasLaptop: false,
  hidden: false,
  sneaking: false,
  running: false,
  over: false,
  target: null, // a click-to-walk point in the isometric view
  message: "",
};
const flights = [];
const effects = [];
let ready = false;
let thief = null;
let guards = [];

function say(text) {
  game.message = text;
}

function setBanner(html) {
  $("banner").innerHTML = html;
}

function finish(title, detail, color) {
  game.over = true;
  setBanner(`<div style="color:${color}">${title}<small>${detail}</small></div>`);
}

function setLamp(on) {
  game.lampOn = on;
  lampLight.visible = on;
  shadeMat.emissiveIntensity = on ? 1.2 : 0.05;
}
setLamp(game.lampOn);

let audio = null;
const startAudio = () => {
  audio ??= new AudioContext();
};
window.addEventListener("pointerdown", startAudio);
window.addEventListener("keydown", startAudio);

/** Small synthesised sound effects: a thud, a footstep, a click, an alarm and a win chime. */
function sound(kind) {
  if (!audio) return;
  const now = audio.currentTime;
  if (kind === "thud" || kind === "step") {
    const length = kind === "thud" ? 0.3 : 0.06;
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * length), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = kind === "thud" ? 380 : 900;
    const gain = audio.createGain();
    gain.gain.value = kind === "thud" ? 0.9 : 0.12;
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start(now);
    return;
  }
  const notes = { click: [[1400, 0.05]], alert: [[660, 0.12], [990, 0.3]], win: [[523, 0.15], [659, 0.15], [784, 0.4]] }[kind];
  let at = now;
  for (const [frequency, length] of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = kind === "click" ? "square" : kind === "alert" ? "sawtooth" : "triangle";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(kind === "click" ? 0.06 : 0.12, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + length);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + length);
    at += length * 0.8;
  }
}

function ringEffect(x, z, size, color = 0xffffff) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.03, z);
  scene.add(ring);
  effects.push({ mesh: ring, age: 0, life: 1.2, size });
}

const HEARD = ["What was that?", "Did you hear that?", "Hello? Anyone there?"];

/** A noise: guards within the radius go and check, unless they are busy with something more urgent. */
function noise(x, z, radius) {
  ringEffect(x, z, radius);
  for (const guard of guards) {
    if (["chase", "search", "relight"].includes(guard.state)) continue;
    if (Math.hypot(guard.person.root.position.x - x, guard.person.root.position.z - z) > radius) continue;
    guard.state = "investigate";
    guard.goal = [x, z];
    speak(guard, HEARD[Math.floor(Math.random() * HEARD.length)]);
  }
}

// ---------------------------------------------------------------------------
// Characters with real animations

const loader = new GLTFLoader();

function character(gltf, { restyle = null, turn = 0 } = {}) {
  const root = new THREE.Group();
  const model = SkeletonUtils.clone(gltf.scene);
  model.rotation.y = turn; // the two models face different ways; this makes both face +z
  model.traverse((part) => {
    if (!part.isMesh) return;
    part.castShadow = true;
    part.frustumCulled = false; // animated meshes move outside their resting bounds
    if (restyle) {
      part.material = part.material.clone();
      restyle(part.material);
    }
  });
  root.add(model);
  scene.add(root);
  const mixer = new THREE.AnimationMixer(model);
  const actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name.toLowerCase(), mixer.clipAction(clip)]));
  return { root, mixer, actions, current: null, speed: 0, last: new THREE.Vector3(), sneak: null, sneakWeight: 0, sneaking: false };
}

function play(person, name, timeScale = 1) {
  const next = person.actions[name];
  if (!next) return;
  next.timeScale = timeScale;
  if (person.current === next) return;
  next.reset().setEffectiveWeight(1).fadeIn(0.25).play();
  person.current?.fadeOut(0.25);
  person.current = next;
}

/** Plays idle, walk or run to match how fast the character really moved, so feet don't slide. */
function animate(person, dt) {
  const moved = person.root.position.distanceTo(person.last) / Math.max(dt, 1e-4);
  person.last.copy(person.root.position);
  person.speed += (moved - person.speed) * Math.min(1, dt * 8);
  if (person.speed < 0.15) play(person, "idle");
  else if (person.speed < 2.2) play(person, "walk", THREE.MathUtils.clamp(person.speed / 1.4, 0.5, 1.4));
  else play(person, "run", THREE.MathUtils.clamp(person.speed / 3.4, 0.7, 1.3));
  if (person.sneak) {
    person.sneakWeight += ((person.sneaking ? 1 : 0) - person.sneakWeight) * Math.min(1, dt * 6);
    person.sneak.setEffectiveWeight(person.sneakWeight);
  }
  person.mixer.update(dt);
}

function iconTexture(text, color) {
  return canvasTexture(64, (g) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(32, 32, 28, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#10141c";
    g.font = "bold 36px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 32, 34);
  });
}
const ICONS = { "?": iconTexture("?", "#f5b942"), "!": iconTexture("!", "#ff3b3b") };

function makeGuard(model, letter, x, z, behaviour) {
  const person = character(model, { turn: Math.PI });
  person.root.position.set(x, 0, z);
  person.last.copy(person.root.position);
  const letterIcon = iconTexture(letter, "#ef5d5d");
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterIcon, depthTest: false }));
  icon.scale.set(0.34, 0.34, 1);
  icon.position.y = 2.15;
  icon.renderOrder = 10;
  person.root.add(icon);
  // The red fan on the floor shows where the guard can see. It is rebuilt every frame so walls cut it off.
  const fanGeometry = new THREE.BufferGeometry();
  fanGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((FAN_RAYS + 2) * 3), 3));
  fanGeometry.setIndex(Array.from({ length: FAN_RAYS }, (_, i) => [0, i + 1, i + 2]).flat());
  const fan = new THREE.Mesh(fanGeometry, new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
  fan.frustumCulled = false;
  scene.add(fan);
  const flashlight = new THREE.SpotLight(0xfff0d0, 30, 7, 0.5, 0.5, 1.6);
  flashlight.position.set(0.15, 1.35, 0.25);
  flashlight.target.position.set(0.15, 0, 3);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(512, 512);
  flashlight.shadow.bias = -0.004;
  flashlight.shadow.normalBias = 0.05;
  person.root.add(flashlight, flashlight.target);
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.hidden = true;
  $("bubbles").append(bubble);
  return { name: `Guard ${letter}`, person, icon, letterIcon, fan, bubble, bubbleUntil: 0, state: "idle", alert: 0, goal: null, until: 0, ...behaviour };
}

/** A guard who stands at a post and sweeps the room. */
function post(x, z, yaw) {
  return {
    home: () => [x, z],
    idle(guard, dt, time) {
      if (walk(guard.person.root, x, z, 1.1, dt)) guard.person.root.rotation.y = yaw + Math.sin(time * 0.7) * 0.65;
    },
  };
}

/** A guard who walks between points and looks into the room at each one. */
function patrol(points) {
  let index = 0;
  let pauseUntil = 0;
  return {
    home: () => points[index],
    idle(guard, dt, time) {
      const body = guard.person.root;
      if (time < pauseUntil) {
        body.rotation.y += angleTo(body.rotation.y, Math.PI + Math.sin(time * 1.2) * 0.7) * Math.min(1, dt * 4);
        return;
      }
      if (walk(body, ...points[index], 0.9, dt)) {
        index = (index + 1) % points.length;
        pauseUntil = time + 1.6;
      }
    },
  };
}

function speak(guard, text) {
  guard.bubble.textContent = text;
  guard.bubble.hidden = false;
  guard.bubbleUntil = clock.elapsedTime + 2.6;
}

/** Guards see in a cone, not through walls, the bookshelf or the closet. Less far in the dark or when you sneak. */
function sees(guard) {
  if (game.hidden) return false;
  const body = guard.person.root;
  const range = (game.lampOn ? 5 : 1.8) * (game.sneaking ? 0.6 : 1);
  const dx = thief.root.position.x - body.position.x;
  const dz = thief.root.position.z - body.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance > range) return false;
  if (Math.abs(angleTo(body.rotation.y, Math.atan2(dx, dz))) > HALF_ANGLE && distance > 0.8) return false;
  raycaster.set(eye.set(body.position.x, 1.4, body.position.z), direction.set(dx, 0, dz).normalize());
  raycaster.far = distance;
  return raycaster.intersectObjects(blockers, false).length === 0;
}

function caughtBy(guard, line) {
  speak(guard, line);
  sound("alert");
  finish("CAUGHT", `${guard.name} caught you. Press R to try again.`, "#ef5d5d");
}

function updateGuard(guard, dt, time) {
  const body = guard.person.root;
  const seen = sees(guard);
  guard.alert = THREE.MathUtils.clamp(guard.alert + (seen ? dt * (game.running ? 2.2 : 1.3) : -dt * 0.3), 0, 1);
  if (seen) guard.goal = [thief.root.position.x, thief.root.position.z];

  if (guard.alert >= 1 && guard.state !== "chase") {
    guard.state = "chase";
    speak(guard, "Hey! Stop right there!");
    sound("alert");
  } else if (seen && guard.alert >= 0.3 && ["idle", "return", "look", "investigate"].includes(guard.state)) {
    guard.state = "suspicious";
    speak(guard, "Hm? Who's there?");
  }

  switch (guard.state) {
    case "chase": {
      const arrived = walk(body, ...guard.goal, 2.6, dt);
      if (!game.hidden && flat(body.position, thief.root.position) < 0.6) return caughtBy(guard, "Got you!");
      if (arrived && !seen) {
        guard.state = "look";
        guard.until = time + 3;
        guard.alert = 0.5;
        speak(guard, "Where did they go?");
      }
      break;
    }
    case "suspicious":
      turnToward(body, guard.goal[0] - body.position.x, guard.goal[1] - body.position.z, dt, 4);
      if (guard.alert <= 0) {
        guard.state = "return";
        speak(guard, "Must be my eyes.");
      }
      break;
    case "investigate":
      if (walk(body, ...guard.goal, 1.3, dt)) {
        guard.state = "look";
        guard.until = time + 2.5;
      }
      break;
    case "search":
      if (walk(body, ...CLOSET_FRONT, 1.6, dt)) {
        if (game.hidden) return caughtBy(guard, "Found you!");
        guard.state = "look";
        guard.until = time + 2;
        speak(guard, "Empty…");
      }
      break;
    case "relight":
      if (walk(body, ...LAMP_FRONT, 1.4, dt)) {
        if (!game.lampOn) {
          setLamp(true);
          sound("click");
          speak(guard, "That's better.");
        }
        game.relightBy = null;
        guard.state = "return";
      }
      break;
    case "look":
      body.rotation.y += dt * 1.5;
      if (time > guard.until) {
        guard.state = "return";
        speak(guard, "Nothing here.");
      }
      break;
    case "return":
      if (walk(body, ...guard.home(), 1.1, dt)) guard.state = "idle";
      break;
    default:
      guard.idle(guard, dt, time);
  }
}

/** In the dark, the nearest free guard goes to switch the lamp back on. */
function sendSomeoneToTheLamp(time) {
  if (game.lampOn || game.relightBy || time - game.darkSince < 2) return;
  const free = guards.filter((guard) => ["idle", "return", "look"].includes(guard.state));
  free.sort((a, b) => flat(a.person.root.position, { x: LAMP_FRONT[0], z: LAMP_FRONT[1] }) - flat(b.person.root.position, { x: LAMP_FRONT[0], z: LAMP_FRONT[1] }));
  const guard = free[0];
  if (!guard) return;
  guard.state = "relight";
  game.relightBy = guard;
  speak(guard, "Who turned off the light?");
}

const head = new THREE.Vector3();

/** How far a ray from (x, z) travels before leaving the room. */
function distanceToRoomEdge(x, z, dx, dz) {
  const tx = dx > 0 ? (ROOM - x) / dx : dx < 0 ? (-ROOM - x) / dx : Infinity;
  const tz = dz > 0 ? (ROOM - z) / dz : dz < 0 ? (-ROOM - z) / dz : Infinity;
  return Math.min(tx, tz);
}

/** Casts rays across the guard's view so the fan stops at walls, the bookshelf and the closet. */
function updateFan(guard) {
  const body = guard.person.root;
  const range = game.lampOn ? 5 : 1.8;
  const positions = guard.fan.geometry.attributes.position;
  positions.setXYZ(0, body.position.x, 0.025, body.position.z);
  for (let i = 0; i <= FAN_RAYS; i++) {
    const angle = body.rotation.y - HALF_ANGLE + (2 * HALF_ANGLE * i) / FAN_RAYS;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    raycaster.set(eye.set(body.position.x, 1.0, body.position.z), direction.set(dx, 0, dz));
    raycaster.far = Math.min(range, distanceToRoomEdge(body.position.x, body.position.z, dx, dz));
    const reach = raycaster.intersectObjects(blockers, false)[0]?.distance ?? raycaster.far;
    positions.setXYZ(i + 1, body.position.x + dx * reach, 0.025, body.position.z + dz * reach);
  }
  positions.needsUpdate = true;
}

function updateGuardVisuals(guard, time) {
  updateFan(guard);
  guard.fan.material.opacity = 0.14 + guard.alert * 0.3;
  guard.icon.material.map = guard.state === "chase" ? ICONS["!"] : guard.state === "suspicious" || guard.alert >= 0.3 ? ICONS["?"] : guard.letterIcon;
  if (time > guard.bubbleUntil) guard.bubble.hidden = true;
  if (guard.bubble.hidden) return;
  head.copy(guard.person.root.position).setY(2.45).project(camera);
  guard.bubble.style.left = `${(head.x * 0.5 + 0.5) * window.innerWidth}px`;
  guard.bubble.style.top = `${(-head.y * 0.5 + 0.5) * window.innerHeight}px`;
}

// ---------------------------------------------------------------------------
// The thief's actions

const aim = new THREE.Vector3(0, 0, 0);
const aimRing = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.16, 24), new THREE.MeshBasicMaterial({ color: 0xf5b942, transparent: true, opacity: 0.7, depthWrite: false }));
aimRing.rotation.x = -Math.PI / 2;
scene.add(aimRing);

function throwShoe() {
  if (game.over || game.hidden) return;
  if (game.shoeThrown) return say("You only had one spare shoe.");
  game.shoeThrown = true;
  const from = new THREE.Vector3(thief.root.position.x, 1.2, thief.root.position.z);
  const to = new THREE.Vector3(aim.x, 0.06, aim.z);
  const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.1), material(0x3b2a20));
  shoe.castShadow = true;
  scene.add(shoe);
  flights.push({ mesh: shoe, from, to, t: 0 });
  thief.root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  say("You throw the shoe.");
}

function toggleLamp(time) {
  if (game.over || game.hidden) return;
  if (Math.hypot(thief.root.position.x - LAMP.x, thief.root.position.z - LAMP.z) > 1.4) return say("Stand next to the lamp to switch it.");
  setLamp(!game.lampOn);
  game.darkSince = time;
  sound("click");
  say(game.lampOn ? "You switch the lamp on." : "You switch the lamp off. The room goes dark.");
  noise(LAMP.x, LAMP.z, 1.2); // a soft click
}

function takeLaptop() {
  if (game.over || game.hasLaptop || game.hidden) return;
  if (flat(thief.root.position, LAPTOP_SPOT) > 1.1) return say("Get next to the desk first.");
  game.hasLaptop = true;
  thief.root.add(laptop);
  laptop.position.set(0, 1.15, -0.22);
  laptop.rotation.set(1.3, 0, 0); // carried flat against the back
  targetRing.visible = false;
  say("You grab the laptop. Get to an exit!");
}

function toggleHiding() {
  if (game.over) return;
  if (game.hidden) {
    game.hidden = false;
    thief.root.position.set(CLOSET_FRONT[0], 0, CLOSET_FRONT[1]);
    return say("You step out of the closet.");
  }
  if (flat(thief.root.position, { x: CLOSET_FRONT[0], z: CLOSET_FRONT[1] }) > 1.0) return say("Get to the closet first.");
  const witness = guards.find((guard) => sees(guard));
  game.hidden = true;
  game.target = null;
  say("You squeeze into the closet and hold your breath.");
  if (witness) {
    witness.state = "search";
    speak(witness, "I saw you go in there!");
  }
}

// ---------------------------------------------------------------------------
// Input

const keys = new Set();
const pointer = new THREE.Vector2();

function floorPoint(event) {
  pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  raycaster.far = Infinity;
  return raycaster.intersectObject(floor, false)[0]?.point ?? null;
}

let drag = null;
canvas.addEventListener("pointerdown", (event) => {
  drag = { x: event.clientX, y: event.clientY, moved: 0 };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (camera === iso) {
    const point = floorPoint(event);
    if (point) aim.copy(point);
  }
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  drag.x = event.clientX;
  drag.y = event.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (camera === follow) {
    view.yaw -= dx * 0.006;
    view.pitch = THREE.MathUtils.clamp(view.pitch + dy * 0.004, 0.08, 1.2);
  }
});
canvas.addEventListener("pointerup", (event) => {
  if (drag && drag.moved < 6 && camera === iso && !game.over && !game.hidden) {
    const point = floorPoint(event);
    if (point) game.target = [point.x, point.z];
  }
  drag = null;
});
canvas.addEventListener("wheel", (event) => {
  view.distance = THREE.MathUtils.clamp(view.distance + event.deltaY * 0.003, 2.2, 6.5);
}, { passive: true });

window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (!ready || event.repeat) return;
  if (event.code === "KeyT") throwShoe();
  if (event.code === "KeyL") toggleLamp(clock.elapsedTime);
  if (event.code === "KeyE") takeLaptop();
  if (event.code === "KeyF") toggleHiding();
  if (event.code === "KeyC") game.sneaking = !game.sneaking;
  if (event.code === "KeyR") location.reload();
  if (event.code === "KeyV") {
    camera = camera === iso ? follow : iso;
    view.snap = true;
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());

let stepClock = 0;

function controlThief(dt) {
  game.running = false;
  if (game.hidden) return;
  let forward = 0;
  let right = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) forward += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) forward -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) right += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) right -= 1;
  const body = thief.root;
  if (forward || right) {
    game.target = null;
    const yaw = camera === iso ? -Math.PI / 4 : view.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const dx = fx * forward - fz * right;
    const dz = fz * forward + fx * right;
    const length = Math.hypot(dx, dz);
    game.running = (keys.has("ShiftLeft") || keys.has("ShiftRight")) && !game.sneaking;
    const speed = game.running ? SPEED.run : game.sneaking ? SPEED.sneak : SPEED.walk;
    walk(body, body.position.x + dx / length, body.position.z + dz / length, speed, dt);
  } else if (game.target && walk(body, ...game.target, game.sneaking ? SPEED.sneak : SPEED.walk, dt)) {
    game.target = null;
  }
  // Running is loud: every few steps, nearby guards can hear you.
  stepClock += dt;
  if (game.running && stepClock > 0.33) {
    stepClock = 0;
    sound("step");
    noise(body.position.x, body.position.z, 2.5);
  }
  thief.sneaking = game.sneaking;
}

function updateFollowCamera(dt) {
  const target = thief.root.position.clone().setY(1.35);
  const offset = new THREE.Vector3(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch));
  // Keep the camera inside the room: shorten the arm near walls and look down a little more instead.
  let arm = view.distance;
  for (const axis of ["x", "z"]) {
    const edge = ROOM - 0.25;
    if (offset[axis] > 0) arm = Math.min(arm, (edge - target[axis]) / offset[axis]);
    if (offset[axis] < 0) arm = Math.min(arm, (-edge - target[axis]) / offset[axis]);
  }
  arm = Math.max(0.9, arm);
  const desired = target.clone().addScaledVector(offset, arm);
  desired.y += (view.distance - arm) * 0.45;
  if (view.snap) follow.position.copy(desired);
  else follow.position.lerp(desired, 1 - Math.exp(-dt * 8));
  view.snap = false;
  follow.lookAt(target);
  // Walls between the camera and the thief turn see-through.
  raycaster.set(follow.position, direction.subVectors(target, follow.position).normalize());
  raycaster.far = follow.position.distanceTo(target);
  const hidden = new Set(raycaster.intersectObjects(walls, false).map((hit) => hit.object));
  fadeWalls(dt, hidden);
  // In this view the shoe lands 5 m ahead of where the camera looks.
  const landing = new THREE.Vector3(-Math.sin(view.yaw), 0, -Math.cos(view.yaw)).multiplyScalar(5).add(thief.root.position);
  aim.set(THREE.MathUtils.clamp(landing.x, -ROOM + 0.2, ROOM - 0.2), 0, THREE.MathUtils.clamp(landing.z, -ROOM + 0.2, ROOM - 0.2));
}

function fadeWalls(dt, hidden) {
  for (const wall of walls) {
    const goal = hidden.has(wall) ? 0.15 : 1;
    wall.material.opacity += (goal - wall.material.opacity) * Math.min(1, dt * 10);
    wall.material.depthWrite = wall.material.opacity > 0.9;
  }
}

function updateHud() {
  const pace = game.hidden ? "hidden in the closet" : game.running ? "running (noisy!)" : game.sneaking ? "sneaking" : "walking";
  const lines = [
    `You: <b>${pace}</b> · Lamp: <b>${game.lampOn ? "on" : "off"}</b> · Shoe: <b>${game.shoeThrown ? "thrown" : "in hand"}</b> · Laptop: <b>${game.hasLaptop ? "yours" : "on the desk"}</b> · Camera: <b>${camera === iso ? "overview" : "behind you"}</b>`,
    game.message,
  ];
  $("status").innerHTML = lines.filter(Boolean).map((line, index) => (index === 0 ? line : `<span class="say">${line}</span>`)).join("");
}

// ---------------------------------------------------------------------------
// The loop. It starts drawing the room while the characters load.

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (ready) {
    if (!game.over) {
      controlThief(dt);
      for (const guard of guards) {
        if (!game.over) updateGuard(guard, dt, time);
      }
      sendSomeoneToTheLamp(time);
      if (!game.over && game.hasLaptop && exits.some((exit) => flat(thief.root.position, exit) < 0.7)) {
        sound("win");
        finish("ESCAPED", "You got out with the laptop. Press R to play again.", "#48c487");
      }
    }
    thief.root.visible = !game.hidden;
    animate(thief, dt);
    for (const guard of guards) {
      animate(guard.person, dt);
      updateGuardVisuals(guard, time);
    }
    if (camera === follow) updateFollowCamera(dt);
    else fadeWalls(dt, new Set());
    updateHud();
  }

  for (const flight of [...flights]) {
    flight.t = Math.min(1, flight.t + dt / 0.7);
    flight.mesh.position.lerpVectors(flight.from, flight.to, flight.t);
    flight.mesh.position.y += Math.sin(flight.t * Math.PI) * 1.2;
    flight.mesh.rotation.z += dt * 12;
    if (flight.t >= 1) {
      flights.splice(flights.indexOf(flight), 1);
      flight.mesh.rotation.set(0, 0.6, 0);
      sound("thud");
      noise(flight.to.x, flight.to.z, 5);
      say("The shoe lands with a thud.");
    }
  }
  for (const effect of [...effects]) {
    effect.age += dt;
    const k = effect.age / effect.life;
    effect.mesh.scale.setScalar(0.2 + k * effect.size);
    effect.mesh.material.opacity = 0.8 * (1 - k);
    if (k >= 1) {
      scene.remove(effect.mesh);
      effects.splice(effects.indexOf(effect), 1);
    }
  }

  targetRing.rotation.z += dt * 1.5;
  targetRing.position.y = 1.25 + Math.sin(time * 2) * 0.04;
  for (const exit of exits) exit.mesh.material.opacity = 0.25 + Math.sin(time * 3) * 0.1;
  aimRing.position.set(aim.x, 0.03, aim.z);
  aimRing.visible = ready && !game.shoeThrown && !game.over;

  renderer.render(scene, camera);
});

// ---------------------------------------------------------------------------
// Load the characters, then start the game.

try {
  const [soldier, bot] = await Promise.all([loader.loadAsync(`${CHARACTERS}Soldier.glb`), loader.loadAsync(`${CHARACTERS}Xbot.glb`)]);
  // The X Bot's sneak pose is an extra layer on top of walking.
  const sneakSource = bot.animations.find((clip) => clip.name === "sneak_pose");
  THREE.AnimationUtils.makeClipAdditive(sneakSource);
  const sneakClip = THREE.AnimationUtils.subclip(sneakSource, "sneak", 2, 3, 30);

  // A dark stealth suit with glowing amber seams.
  thief = character(bot, {
    restyle(suit) {
      if (suit.name.toLowerCase().includes("joint")) {
        suit.color.set(0x2a2d35);
        suit.emissive.set(0xf5b942);
        suit.emissiveIntensity = 0.8;
      } else {
        suit.color.set(0x1a1d23);
      }
    },
  });
  thief.sneak = thief.mixer.clipAction(sneakClip);
  thief.sneak.setEffectiveWeight(0).play();
  thief.root.position.set(-2.4, 0, -2.55);
  thief.root.rotation.y = 0.755;
  thief.last.copy(thief.root.position);
  const footRing = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 32), new THREE.MeshBasicMaterial({ color: 0xf5b942, transparent: true, opacity: 0.8, depthWrite: false }));
  footRing.rotation.x = -Math.PI / 2;
  footRing.position.y = 0.02;
  thief.root.add(footRing);

  guards = [
    makeGuard(soldier, "A", 2.0, -1.85, post(2.0, -1.85, -0.76)), // protects the laptop
    makeGuard(soldier, "B", -0.7, 2.55, patrol([[-0.7, 2.55], [1.9, 2.55]])), // watches the door
  ];
  ready = true;
  setBanner("");
  if (params.has("debug")) window.heist = { thief, guards, game }; // lets the test driver look inside
  if (params.has("sneak")) game.sneaking = true;
  const autoThrow = params.get("throw")?.split(",").map(Number); // for screenshots: ?throw=x,z
  if (autoThrow?.length === 2) {
    setTimeout(() => {
      aim.set(autoThrow[0], 0, autoThrow[1]);
      throwShoe();
    }, 600);
  }
} catch (error) {
  setBanner(`<div style="font-size:20px">Could not load the characters.<small>${error.message}. The 3D characters come from the internet, so check the connection.</small></div>`);
}
