// The game kit. Every game the AI writes runs on it. It sets up three.js (renderer, scene, camera,
// sky and the game loop) and gives games animated people and creatures, ready-made things,
// controls, a heads-up display, sounds, particles and simple collisions, and Meta's AI while the
// game runs: a world model that decides what happens, and minds for characters (live.js).
// Games can also use three.js directly for anything the kit doesn't cover.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { buildF1Car } from "./f1car.js";
import { buildRoadCar, ROAD_CARS } from "./roadcar.js";
import { createLive } from "./live.js";
import { breakUpRepetition } from "./notile.js";
import { loadCharacters, makeCharacter, play } from "../characters.js";
import { floorTexture, label as makeLabel, makeThing } from "../level-builder.js";

// Day and sunset use a real sky (sun, haze and blue) that also lights the scene and shows in
// reflections. The others are solid colours, with soft studio light for reflections.
const SKIES = {
  day: { background: 0x8ec5ff, fog: 0xc9dcef, hemisphere: [0xffffff, 0x6a5a40, 0.5], sun: [0xfff4e0, 2.1], sunFrom: [30, 50, 20], air: { turbidity: 4, rayleigh: 2.2 } },
  sunset: { background: 0xf29a6b, fog: 0xe8a77f, hemisphere: [0xffd2b0, 0x4a3040, 0.5], sun: [0xffa860, 2.4], sunFrom: [-40, 9, 10], air: { turbidity: 10, rayleigh: 3 } },
  night: { background: 0x0b1020, fog: 0x0b1020, hemisphere: [0x6f86c8, 0x1a1410, 0.7], sun: [0x9bb8ff, 1.1], sunFrom: [-20, 40, -10] },
  space: { background: 0x020208, fog: null, hemisphere: [0x8090ff, 0x101020, 0.6], sun: [0xffffff, 2.4], sunFrom: [40, 30, 20], stars: true },
  underwater: { background: 0x0a4a6a, fog: 0x0a5a7a, hemisphere: [0x8fe0ff, 0x0a2a3a, 1.1], sun: [0xbff0ff, 1.4], sunFrom: [0, 40, 5] },
  indoor: { background: 0x15131a, fog: 0x15131a, hemisphere: [0xfff0dd, 0x302820, 1.1], sun: [0xfff0dd, 1.3], sunFrom: [10, 30, 10] },
};

const GROUNDS = {
  grass: ["grass", 0x5f8a3a],
  sand: ["noise", 0xd9c38c],
  snow: ["noise", 0xeef3f8],
  dirt: ["noise", 0x7a5a3a],
  stone: ["stone", 0x8a8780],
  tiles: ["tiles", 0xd9d4ca],
  planks: ["planks", 0x8a6a4a],
  road: ["road", 0x34363a],
  water: ["water", 0x2a6a9a],
  lava: ["lava", 0xd9541e],
  ice: ["tiles", 0xbfe3f2],
  metal: ["tiles", 0x7d858c],
};

const BLOCKING_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);
// Models come from the kit's own server, even inside the sealed frame (which has no origin of its own).
const MODEL_ROOT = new URL("../models/", import.meta.url).href;
// Real photographed sky and scanned surfaces (Poly Haven, CC0).
const ASSETS = new URL("../assets/polyhaven/", import.meta.url).href;
const REAL_SKY = `${ASSETS}sky/kloofendal_2k.hdr`;
const REAL_SURFACES = ["asphalt", "grass", "gravel"];
// Poly Haven's whole library: models, surfaces and skies, loaded from its servers ("polyhaven/<id>").
// public/models/polyhaven.json (npm run polyhaven) lists them, with each model's size and files.
const POLYHAVEN_INDEX = `${MODEL_ROOT}polyhaven.json`;
const POLYHAVEN_FILES = "https://dl.polyhaven.org/file/ph-assets/";
const POLYHAVEN = "polyhaven/";
// Packs whose files store colours the wrong way (screen colours saved as light values), so they
// would show washed out. Their colours are converted when they load.
const SCREEN_COLOUR_PACKS = new Set(["racing"]);

/** Fixes a freshly loaded model: true colours, and a little shine on paint and glass. */
function prepareModel(scene, pack) {
  scene.traverse((part) => {
    if (!part.isMesh) return;
    for (const material of [part.material].flat()) {
      if (material.userData.prepared) continue;
      material.userData.prepared = true;
      if (SCREEN_COLOUR_PACKS.has(pack)) material.color?.convertSRGBToLinear();
      const name = material.name.toLowerCase();
      if (name.includes("glass") || name.includes("window")) Object.assign(material, { roughness: 0.08, metalness: 0.4 });
      else if (!/tire|tyre|rubber|wheel/.test(name) && material.roughness === 1) material.roughness = 0.6;
    }
  });
}

/** Sends a message to the page around the game (the test browser reads these). */
const report = (message) => window.parent?.postMessage({ source: "kit", ...message }, "*");

function canvasTexture(draw) {
  const surface = document.createElement("canvas");
  surface.width = surface.height = 256;
  draw(surface.getContext("2d"), 256);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function groundTexture(type) {
  const [pattern, color] = GROUNDS[type] ?? GROUNDS.grass;
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const hex = (shade) => `#${new THREE.Color(color).multiplyScalar(shade).getHexString()}`;
  if (pattern === "road") {
    return canvasTexture((g, size) => {
      g.fillStyle = hex(1);
      g.fillRect(0, 0, size, size);
      for (let i = 0; i < 500; i++) (g.fillStyle = hex(0.8 + random() * 0.4)), g.fillRect(random() * size, random() * size, 2, 2);
      g.fillStyle = "#e8e2c0";
      g.fillRect(size / 2 - 4, 0, 8, size / 2); // a dashed centre line
    });
  }
  if (pattern === "water" || pattern === "lava") {
    return canvasTexture((g, size) => {
      g.fillStyle = hex(1);
      g.fillRect(0, 0, size, size);
      for (let i = 0; i < 60; i++) {
        g.strokeStyle = hex(pattern === "lava" ? 1.5 : 1.35);
        g.lineWidth = 2;
        g.beginPath();
        const x = random() * size;
        const y = random() * size;
        g.moveTo(x, y);
        g.quadraticCurveTo(x + 12, y - 6, x + 24, y);
        g.stroke();
      }
    });
  }
  return floorTexture(pattern === "noise" ? "concrete" : pattern, color, random);
}

// ---------------------------------------------------------------------------

export async function startKit({ catalog, models = {} }) {
  // Poly Haven's list (models, surfaces, skies). Without it, "polyhaven/…" names simply aren't found.
  const polyhaven = await fetch(POLYHAVEN_INDEX)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;display:block";
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // the glow pass is costly at full resolution
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps colours true: a red car stays red in sunlight
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  camera.position.set(0, 8, 12);
  camera.lookAt(0, 0, 0);

  // Drawing passes: the scene (with 4× anti-aliasing), a soft glow on bright things, then colour output.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  // Clean bad pixels before the glow: one invalid pixel (from a shape squashed flat, say) would
  // otherwise be blurred across the whole screen and turn it black.
  composer.addPass(
    new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader:
        "uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = min(c, vec4(40.0)); }",
    }),
  );
  const glow = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 2.2); // only truly bright things glow, not sunlit white walls
  composer.addPass(glow);
  // Lens: motion blur from the centre that grows with kit.effects.speed, and darker corners.
  const lens = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, speed: { value: 0 }, vignette: { value: 0.3 } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform sampler2D tDiffuse; uniform float speed; uniform float vignette; varying vec2 vUv;
      void main() {
        vec2 away = vUv - 0.5;
        vec4 colour = vec4(0.0);
        float total = 0.0;
        for (int i = 0; i < 10; i++) {
          float k = float(i) / 9.0;
          float weight = 1.0 - 0.6 * k;
          colour += texture2D(tDiffuse, vUv - away * k * speed * 0.07 * smoothstep(0.05, 0.45, length(away))) * weight;
          total += weight;
        }
        colour /= total;
        colour.rgb *= 1.0 - vignette * smoothstep(0.3, 0.85, length(away));
        gl_FragColor = colour;
      }`,
  });
  composer.addPass(lens);
  composer.addPass(new OutputPass());
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    composer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  const updates = new Set();
  const timers = [];
  const people = [];
  const particles = [];
  const solids = [];
  let view = null; // how the camera follows something
  let paused = false; // while the player types something for the world model
  let skyParts = [];
  let sun = null;
  const lamps = []; // every lamp; only the nearest few get one of the real lights below
  const lampLights = [];
  const LAMP_LIGHTS = 6;

  // Controls -------------------------------------------------------------
  const held = new Set();
  const pressed = new Set();
  window.addEventListener("keydown", (event) => {
    if (BLOCKING_KEYS.has(event.code)) event.preventDefault();
    if (!held.has(event.code)) pressed.add(event.code);
    held.add(event.code);
    if (event.code === "KeyR" && kit.over) restart();
    audio?.resume();
  });
  window.addEventListener("keyup", (event) => held.delete(event.code));
  window.addEventListener("blur", () => held.clear());
  const pointer = {
    x: 0,
    y: 0,
    down: false,
    clicked: false,
    /** A ray from the camera through the pointer, for picking and aiming. */
    ray() {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), camera);
      return raycaster;
    },
    /** Where the pointer meets the flat ground at height y. */
    groundPoint(y = 0) {
      const point = new THREE.Vector3();
      return pointer.ray().ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), point) ? point : null;
    },
  };
  const move = (event) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  };
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerdown", (event) => {
    move(event);
    pointer.down = pointer.clicked = true;
    audio?.resume();
  });
  window.addEventListener("pointerup", () => (pointer.down = false));

  // Heads-up display ------------------------------------------------------
  const style = document.createElement("style");
  style.textContent = `
    .kit-hud { position: fixed; font-family: system-ui, sans-serif; color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,.8); pointer-events: none; }
    #kit-lines { left: 16px; top: 12px; font-size: 18px; font-weight: 700; line-height: 1.45; }
    #kit-big { inset: 0; display: grid; place-items: center; text-align: center; font-size: 56px; font-weight: 900; }
    #kit-big small { display: block; font-size: 20px; font-weight: 600; margin-top: 8px; }
    #kit-controls { left: 50%; bottom: 14px; transform: translateX(-50%); font-size: 14px; padding: 6px 12px; border-radius: 10px; background: rgba(0,0,0,.45); white-space: nowrap; }
    #kit-bars { right: 16px; top: 14px; width: 200px; }
    .kit-bar { margin-bottom: 8px; font-size: 13px; font-weight: 700; }
    .kit-bar div { height: 10px; border-radius: 5px; background: rgba(0,0,0,.45); overflow: hidden; margin-top: 3px; }
    .kit-bar span { display: block; height: 100%; }`;
  document.head.append(style);
  const panel = (id) => Object.assign(document.body.appendChild(document.createElement("div")), { id, className: "kit-hud" });
  const lines = panel("kit-lines");
  const big = panel("kit-big");
  const controls = panel("kit-controls");
  const bars = panel("kit-bars");
  controls.hidden = true;
  const escape = (text) => String(text).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
  const barValues = new Map();
  const hud = {
    /** Lines in the top-left corner, such as the score. */
    set: (...text) => (lines.innerHTML = text.map(escape).join("<br>")),
    /** A big title in the middle of the screen; big("") hides it. */
    big: (title, subtitle = "") => (big.innerHTML = title ? `<div>${escape(title)}${subtitle ? `<small>${escape(subtitle)}</small>` : ""}</div>` : ""),
    /** How to play, at the bottom of the screen. */
    controls: (text) => {
      controls.textContent = text;
      controls.hidden = !text;
    },
    /** A bar in the top-right corner, such as health: value from 0 to 1. */
    bar: (name, value, color = "#48c487") => {
      barValues.set(name, { value: Math.max(0, Math.min(1, value)), color });
      bars.innerHTML = [...barValues].map(([key, bar]) => `<div class="kit-bar">${escape(key)}<div><span style="width:${bar.value * 100}%;background:${bar.color}"></span></div></div>`).join("");
    },
  };

  // Sound ----------------------------------------------------------------
  let audio = null;
  function tone(type, from, to, seconds, volume = 0.15, delay = 0) {
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + seconds);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + seconds);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + seconds);
  }
  function noise(seconds, volume = 0.25, cutoff = 1200) {
    const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * seconds), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    source.buffer = buffer;
    filter.frequency.value = cutoff;
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start();
  }
  const SOUNDS = {
    jump: () => tone("square", 300, 640, 0.15, 0.08),
    coin: () => (tone("sine", 880, 880, 0.08), tone("sine", 1320, 1320, 0.18, 0.15, 0.07)),
    hit: () => noise(0.15, 0.3, 900),
    shoot: () => tone("sawtooth", 900, 180, 0.12, 0.07),
    explosion: () => noise(0.7, 0.45, 500),
    powerup: () => tone("triangle", 400, 1400, 0.35, 0.12),
    click: () => tone("square", 1000, 1000, 0.03, 0.05),
    step: () => noise(0.05, 0.08, 600),
    win: () => [523, 659, 784, 1046].forEach((note, i) => tone("triangle", note, note, 0.25, 0.14, i * 0.12)),
    lose: () => tone("sawtooth", 400, 110, 0.7, 0.1),
  };

  // Camera views ------------------------------------------------------------
  function updateView(dt) {
    if (!view?.target) return;
    const at = view.target.position;
    let goal;
    if (view.kind === "follow") {
      const turn = view.behind ? view.target.rotation.y : 0;
      goal = new THREE.Vector3(at.x - Math.sin(turn) * view.distance, at.y + view.height, at.z - Math.cos(turn) * view.distance);
      if (!view.behind) goal.set(at.x, at.y + view.height, at.z + view.distance);
    } else if (view.kind === "overhead") {
      goal = new THREE.Vector3(at.x, at.y + view.height, at.z + view.back);
    } else {
      goal = new THREE.Vector3(at.x, at.y + view.height, at.z + view.distance);
    }
    camera.position.lerp(goal, Math.min(1, dt * view.smooth));
    camera.lookAt(at.x, at.y + (view.kind === "overhead" ? 0 : 1), at.z);
  }

  // Models load once and are copied for every use.
  const modelLoader = new GLTFLoader();
  const loading = {};

  /** A Poly Haven model's loader: its files name their textures by a path that lives elsewhere on Poly Haven's servers. */
  function polyhavenLoader(info) {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      const path = Object.keys(info.files).find((file) => url.endsWith(file));
      return path ? POLYHAVEN_FILES + info.files[path] : url;
    });
    return new GLTFLoader(manager);
  }

  // Real scanned surfaces: each has colour, bumps (normal map) and roughness. Textures load once.
  const textureLoader = new THREE.TextureLoader();
  const surfaceTextures = {};
  const isSurface = (name) => REAL_SURFACES.includes(name) || Boolean(polyhaven?.surfaces[name.slice(POLYHAVEN.length)] && name.startsWith(POLYHAVEN));
  /** The colour, normal and roughness pictures of a surface: the kit's own, or any of Poly Haven's. */
  function surfaceFiles(name) {
    if (!name.startsWith(POLYHAVEN)) return ["diff", "normal", "rough"].map((file) => `${ASSETS}${name}/${file}.jpg`);
    const info = polyhaven.surfaces[name.slice(POLYHAVEN.length)];
    return [info.map, info.normal, info.rough].map((path) => path && POLYHAVEN_FILES + path);
  }
  /** How many metres one copy of a Poly Haven surface covers in real life (null when unknown). */
  const surfaceMetres = (name) => (name?.startsWith?.(POLYHAVEN) ? polyhaven?.surfaces[name.slice(POLYHAVEN.length)]?.metres ?? null : null);
  /** repeat: how many copies of the texture fit across one unit of the geometry's UVs. */
  function realSurface(name, repeat, color) {
    surfaceTextures[name] ??= surfaceFiles(name).map((url, i) => {
      if (!url) return null;
      const texture = textureLoader.load(url);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (i === 0) texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    });
    const [map, normalMap, roughnessMap] = surfaceTextures[name].map((texture) => {
      if (!texture) return null;
      const copy = texture.clone(); // shares the picture; only the repeat differs
      copy.repeat.set(repeat, repeat);
      return copy;
    });
    // A tint keeps its colour but may not make the surface dark: a near-black surface shows only the sky
    // reflected in it, which looks like a mirror instead of brick or asphalt.
    const tint = new THREE.Color(color ?? 0xffffff);
    const hsl = tint.getHSL({}, THREE.SRGBColorSpace);
    if (hsl.l < 0.55) tint.setHSL(hsl.h, hsl.s, 0.55, THREE.SRGBColorSpace);
    return new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, roughness: roughnessMap ? 1 : 0.8, color: tint, side: THREE.DoubleSide });
  }

  /**
   * The surface to use for a name: itself when it exists, or for a made-up Poly Haven name such as
   * "polyhaven/brick_wall_007" the closest real one ("polyhaven/brick_wall_001"). null when nothing fits.
   */
  function knownSurface(name) {
    if (typeof name !== "string") return null;
    if (isSurface(name)) return name;
    if (!name.startsWith(POLYHAVEN) || !polyhaven) return null;
    const stem = (id) => id.toLowerCase().replace(/[_-]?\d+$/, "");
    const wanted = stem(name.slice(POLYHAVEN.length));
    const ids = Object.keys(polyhaven.surfaces);
    const match = ids.find((id) => stem(id) === wanted) ?? ids.find((id) => stem(id).startsWith(wanted)) ?? ids.find((id) => id.startsWith(`${wanted.split("_")[0]}_`));
    if (match) console.warn(`kit: no surface "${name}", using "${POLYHAVEN}${match}"`);
    return match ? POLYHAVEN + match : null;
  }

  /** The canvas picture for red and white kerbs, or a chequered line. */
  function stripes(colours, across = 1) {
    const surface = document.createElement("canvas");
    surface.width = surface.height = 64;
    const g = surface.getContext("2d");
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < across; j++) {
        g.fillStyle = colours[(i + j) % 2];
        g.fillRect((j * 64) / across, i * 32, 64 / across, 32);
      }
    }
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  // Shapes are shared; materials are made per colour and finish.
  const shapes = {
    box: new THREE.BoxGeometry(1, 1, 1),
    rounded: new RoundedBoxGeometry(1, 1, 1, 3, 0.12),
    sphere: new THREE.SphereGeometry(0.5, 32, 20),
    capsule: new THREE.CapsuleGeometry(0.5, 1, 6, 16).scale(1, 0.5, 1), // fits a 1 × 1 × 1 box like the others
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
    cone: new THREE.ConeGeometry(0.5, 1, 32),
    torus: new THREE.TorusGeometry(0.4, 0.1, 16, 48),
  };
  const FINISHES = {
    plastic: { roughness: 0.45, metalness: 0 },
    matte: { roughness: 0.92, metalness: 0 },
    rubber: { roughness: 0.95, metalness: 0 },
    metal: { roughness: 0.32, metalness: 0.9 },
    chrome: { roughness: 0.06, metalness: 1 },
    paint: { roughness: 0.32, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06 },
    glass: { roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.35 },
  };
  /**
   * A box or cylinder of this size whose texture coordinates are in metres, so a real surface keeps its true
   * scale on every face (bricks stay brick-sized on a long wall and on a short pillar).
   */
  function metreGeometry(kind, w, h, d) {
    if (kind === "cylinder" || kind === "cone") {
      const geometry = (kind === "cone" ? new THREE.ConeGeometry(0.5, h, 32) : new THREE.CylinderGeometry(0.5, 0.5, h, 32)).scale(w, 1, d);
      const uv = geometry.attributes.uv;
      const side = 33 * 2; // the side's points come first, then the round ends
      const around = (Math.PI * (w + d)) / 2;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (i < side ? around : w), uv.getY(i) * (i < side ? h : d));
      return geometry;
    }
    if (kind !== "box" && kind !== "rounded") return null; // round shapes keep their own texture coordinates
    const geometry = kind === "rounded" ? new RoundedBoxGeometry(w, h, d, 3, 0.12) : new THREE.BoxGeometry(w, h, d);
    const uv = geometry.attributes.uv;
    const perFace = uv.count / 6;
    const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // ±x, ±y, ±z: each face's width and height
    for (let i = 0; i < uv.count; i++) {
      const [across, up] = faces[Math.floor(i / perFace)];
      uv.setXY(i, uv.getX(i) * across, uv.getY(i) * up);
    }
    return geometry;
  }

  /** How far the point (x, z) is from a wall's centre line, on the ground. */
  function distanceToLine(x, z, { ax, az, bx, bz }) {
    const lx = bx - ax;
    const lz = bz - az;
    const along = Math.max(0, Math.min(1, ((x - ax) * lx + (z - az) * lz) / (lx * lx + lz * lz || 1)));
    return Math.hypot(x - (ax + lx * along), z - (az + lz * along));
  }

  function surface(finish, color, opacity = 1) {
    if (finish === "glow") return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3, roughness: 0.4 });
    const settings = { color, ...(FINISHES[finish] ?? FINISHES.plastic) };
    if (opacity < 1) Object.assign(settings, { transparent: true, opacity });
    return settings.clearcoat ? new THREE.MeshPhysicalMaterial(settings) : new THREE.MeshStandardMaterial(settings);
  }

  /**
   * A real photographed sky: it lights the scene, shows in reflections, and sets where the sun is.
   * tags are Poly Haven's words for the photo: at "night", "indoor" or "overcast" the brightest point is a
   * lamp, a window or bright cloud rather than the sun, so the light is softer and comes from high above.
   */
  async function realSky(url = REAL_SKY, tags = []) {
    const texture = await new RGBELoader().setDataType(THREE.FloatType).loadAsync(url);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    // The sun is the brightest point of the photo. The first row of the picture is the top of the sky.
    const { data, width, height } = texture.image;
    let brightest = 0;
    let at = 0;
    for (let i = 0; i < width * height; i++) {
      const light = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2];
      if (light > brightest) (brightest = light), (at = i);
    }
    const latitude = (0.5 - (Math.floor(at / width) + 0.5) / height) * Math.PI;
    const around = (((at % width) + 0.5) / width - 0.5) * Math.PI * 2;
    const toSun = new THREE.Vector3(Math.cos(around) * Math.cos(latitude), Math.sin(latitude), Math.sin(around) * Math.cos(latitude));
    // Fog takes the colour of the horizon.
    const horizon = [0, 0, 0];
    const row = Math.floor(height / 2) - 3;
    for (let x = 0; x < width; x += 8) for (let c = 0; c < 3; c++) horizon[c] += data[(row * width + x) * 4 + c] / (width / 8);
    const brightestPart = Math.max(...horizon, 1);
    const night = tags.includes("night");
    const soft = night || tags.includes("indoor") || tags.includes("studio") || tags.includes("overcast");
    if (soft) {
      const around = new THREE.Vector2(toSun.x, toSun.z).normalize();
      toSun.set(around.x * Math.cos(0.9), Math.sin(0.9), around.y * Math.cos(0.9)); // 52 degrees up, from the same side
    }
    // Poly Haven photographs night almost as brightly as day, so night light is set to one dim level.
    let skyLight = 0; // light reaching flat ground from the sky
    for (let y = 0; y < height / 2; y++) {
      const up = (0.5 - (y + 0.5) / height) * Math.PI;
      const weight = Math.sin(up) * Math.cos(up);
      for (let x = 0; x < width; x += 4) {
        const i = (y * width + x) * 4;
        skyLight += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * weight;
      }
    }
    skyLight *= (Math.PI / height) * ((2 * Math.PI) / width) * 4;

    for (const part of skyParts) scene.remove(part);
    scene.background = texture;
    scene.backgroundIntensity = night ? 0.75 : 1;
    scene.backgroundBlurriness = 0;
    scene.environment = pmrem.fromEquirectangular(texture).texture;
    scene.environmentIntensity = night ? Math.min(1.2, Math.max(0.15, 0.4 / Math.max(skyLight, 0.01))) : 1;
    scene.fog = new THREE.Fog(new THREE.Color(...horizon.map((value) => value / brightestPart)), 180, 900);
    sun = new THREE.DirectionalLight(night ? 0x9db4ff : 0xfff1dc, night ? 0.45 : soft ? 1.1 : 3.2); // moonlight at night
    sun.userData.from = toSun.multiplyScalar(70);
    sun.position.copy(sun.userData.from);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 220 });
    skyParts = [new THREE.HemisphereLight(0xffffff, 0x3a3a30, 0.1), sun, sun.target];
    scene.add(...skyParts);
  }

  function restart() {
    if (window.parent !== window) report({ kind: "restart" });
    else location.reload();
  }

  const live = createLive({
    report,
    scene,
    THREE,
    label: makeLabel,
    setPaused: (on) => (paused = on),
    clearKeys: () => held.clear(),
    now: () => kit.time,
    isOver: () => kit.over,
  });

  // ---------------------------------------------------------------------------

  const kit = {
    THREE,
    scene,
    camera,
    renderer,
    keys: {
      /** True while the key is held. Codes are like "KeyW", "ArrowUp", "Space", "ShiftLeft". */
      down: (code) => held.has(code),
      /** True only in the frame the key went down. */
      pressed: (code) => pressed.has(code),
    },
    pointer,
    hud,
    over: false,
    time: 0,

    /** Calls fn(dt, time) every frame. Returns a function that stops it. */
    onUpdate(fn) {
      updates.add(fn);
      return () => updates.delete(fn);
    },
    after(seconds, fn) {
      timers.push({ at: kit.time + seconds, fn });
    },
    every(seconds, fn) {
      const tick = () => {
        fn();
        kit.after(seconds, tick);
      };
      kit.after(seconds, tick);
    },

    /**
     * Sky, light and fog: "day", "sunset", "night", "space", "underwater" or "indoor", or "real" for a
     * real photographed sky (await it: it loads a picture of the sky, and the sun is placed where it is in the photo).
     * "polyhaven/<id>" is any of Poly Haven's photographed skies, such as "polyhaven/qwantani_sunset_puresky".
     */
    sky(preset = "day") {
      if (preset === "real") return realSky();
      if (preset.startsWith(POLYHAVEN)) {
        const id = preset.slice(POLYHAVEN.length);
        if (polyhaven?.skies[id]) return realSky(`${POLYHAVEN_FILES}HDRIs/hdr/2k/${id}_2k.hdr`, polyhaven.skies[id].categories ?? []);
        console.warn(`kit.sky: unknown Poly Haven sky "${id}"`);
        return realSky();
      }
      const s = SKIES[preset] ?? SKIES.day;
      for (const part of skyParts) scene.remove(part);
      scene.fog = s.fog === null ? null : new THREE.Fog(s.fog, 90, 420);
      if (s.air) {
        // A real sky: rendered once into a light map that lights and reflects in everything.
        const sky = new Sky();
        sky.scale.setScalar(900);
        const uniforms = sky.material.uniforms;
        uniforms.turbidity.value = s.air.turbidity;
        uniforms.rayleigh.value = s.air.rayleigh;
        uniforms.mieCoefficient.value = 0.005;
        uniforms.mieDirectionalG.value = 0.8;
        uniforms.sunPosition.value.set(...s.sunFrom).normalize();
        const skyScene = new THREE.Scene();
        skyScene.add(sky);
        const light = pmrem.fromScene(skyScene, 0, 0.1, 1000).texture;
        scene.background = light;
        scene.backgroundIntensity = 0.22; // the sky shader is very bright; this keeps it blue
        scene.environment = light;
        scene.environmentIntensity = 0.2;
      } else {
        scene.background = new THREE.Color(s.background);
        scene.environment = studio;
        scene.environmentIntensity = 0.25;
      }
      const hemisphere = new THREE.HemisphereLight(...s.hemisphere);
      sun = new THREE.DirectionalLight(...s.sun);
      sun.userData.from = new THREE.Vector3(...s.sunFrom).normalize().multiplyScalar(60);
      sun.position.copy(sun.userData.from);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.normalBias = 0.03;
      Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
      skyParts = [hemisphere, sun, sun.target];
      if (s.stars) {
        const points = new Float32Array(4500);
        for (let i = 0; i < points.length; i += 3) {
          const direction = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(600);
          points.set([direction.x, direction.y, direction.z], i);
        }
        const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(points, 3));
        skyParts.push(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false })));
      }
      scene.add(...skyParts);
    },

    /**
     * A flat ground: grass, asphalt and gravel are real scanned surfaces, and so is any of Poly Haven's
     * ("polyhaven/<id>", such as "polyhaven/coast_sand_01"); sand, snow, dirt, stone, tiles, planks,
     * road, water, lava, ice and metal are drawn. metres is how far one copy of the surface reaches.
     */
    ground({ type = "grass", size = 200, at = [0, 0, 0], metres } = {}) {
      let material;
      type = knownSurface(type) ?? type;
      if (isSurface(type)) {
        // The scanned grass is a dry field; a little green makes it look watered and mown.
        material = realSurface(type, size / (metres ?? surfaceMetres(type) ?? (type === "grass" ? 8 : 4)), type === "grass" ? 0x9fd27c : undefined);
        breakUpRepetition(material); // a big ground would otherwise show a grid of identical copies
      } else {
        const map = groundTexture(type);
        map.repeat.set(size / 4, size / 4);
        const liquid = type === "water" || type === "lava";
        material = new THREE.MeshStandardMaterial({ map, roughness: liquid ? 0.25 : 0.9, emissive: type === "lava" ? 0x8a2a0a : 0x000000, emissiveIntensity: 0.8 });
      }
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(...at);
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    },

    /**
     * A simple shape: "box", "rounded" (a box with soft edges), "sphere", "capsule", "cylinder", "cone" or "torus".
     * size is [width, height, depth]; at is its centre. material is "plastic" (the default), "paint" (glossy,
     * like a car), "metal", "chrome", "glass", "rubber", "matte" or "glow". surface instead covers it with a real
     * scanned surface ("polyhaven/<id>", "grass", "asphalt" or "gravel"), at the surface's real size on every face
     * of a box or cylinder (or one copy every `metres` metres); color then tints it.
     */
    shape(kind, { size = [1, 1, 1], color, at = [0, 0, 0], rotate = [0, 0, 0], material = "plastic", glow = false, solid = false, opacity = 1, surface: real, metres } = {}) {
      const [w, h, d] = size.map((value) => Math.max(0.002, Math.abs(Number(value) || 0))); // never flat: that breaks the lighting maths
      real = glow ? null : knownSurface(real) ?? real;
      const textured = typeof real === "string" && isSurface(real);
      if (real && !textured) console.warn(`kit.shape: unknown surface "${real}"`);
      const sized = textured ? metreGeometry(kind, w, h, d) : null; // texture coordinates in metres
      const copy = Number(metres) || surfaceMetres(real) || 2; // metres one copy of the surface covers
      const look = textured ? realSurface(real, (sized ? 1 : Math.max(w, h, d)) / copy, color) : surface(glow ? "glow" : material, color ?? "#cccccc", opacity);
      const mesh = new THREE.Mesh(sized ?? shapes[kind] ?? shapes.box, look);
      if (!sized) mesh.scale.set(w, h, d);
      mesh.position.set(...at);
      mesh.rotation.set(...rotate);
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      if (solid) kit.solid(mesh);
      return mesh;
    },

    /**
     * A wall from [x, z] to [x, z] on the ground, covered in a real scanned surface at its true size: the
     * easy way to build rooms, corridors, buildings and fences that look real. Solid by default.
     */
    wall(from, to, { height = 3, thickness = 0.2, surface: real = "polyhaven/painted_plaster_wall", metres, color, base = 0, solid = true } = {}) {
      const [ax, az] = from.map(Number);
      const [bx, bz] = to.map(Number);
      const length = Math.max(0.05, Math.hypot(bx - ax, bz - az));
      const wall = kit.shape("box", { size: [length, height, thickness], at: [(ax + bx) / 2, base + height / 2, (az + bz) / 2], rotate: [0, -Math.atan2(bz - az, bx - ax), 0], surface: real, metres, color });
      if (solid) {
        // A slanted wall's box would block a whole square, so walls block along their line instead.
        kit.solid(wall);
        solids.at(-1).line = { ax, az, bx, bz, half: Math.max(0.01, thickness / 2) };
      }
      return wall;
    },

    /**
     * A light that really lights what is around it: a street lamp, a lantern, a lit window, a torch.
     * at is [x, y, z], or an object it moves with (offset is then where on the object). reach is how far
     * it lights in metres. Returns the lamp: set lamp.on = false to switch it off. Any number is fine:
     * the nearest few to the camera get real light, and the bulbs of the others still glow.
     */
    lamp(at, { color = "#ffd6a0", power = 1, reach = 16, bulb, offset = [0, 2, 0] } = {}) {
      const attached = at?.isObject3D ? at : null;
      const tint = new THREE.Color(color);
      const glowBulb = (bulb ?? !attached) ? new THREE.Mesh(shapes.sphere, new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 4 })) : null;
      let on = true;
      const lamp = {
        object: attached,
        offset: new THREE.Vector3(...(attached ? offset : [0, 0, 0])),
        position: new THREE.Vector3(...(attached ? [0, 0, 0] : Array.isArray(at) ? at.map(Number) : [at?.x ?? 0, at?.y ?? 0, at?.z ?? 0])),
        color: tint,
        power: Math.max(0, Number(power) || 1),
        reach: Math.max(1, Number(reach) || 16),
        bulb: glowBulb,
        get on() {
          return on;
        },
        set on(value) {
          on = Boolean(value);
          if (glowBulb) glowBulb.material.emissiveIntensity = on ? 4 : 0;
        },
        /** Where the lamp is now. */
        where(into = new THREE.Vector3()) {
          return attached ? attached.localToWorld(into.copy(this.offset)) : into.copy(this.position);
        },
      };
      if (glowBulb) {
        glowBulb.scale.setScalar(0.22);
        glowBulb.position.copy(lamp.position);
        scene.add(glowBulb);
      }
      lamps.push(lamp);
      while (lampLights.length < LAMP_LIGHTS) {
        // A fixed set of lights that move to the nearest lamps, so the scene's shaders never change.
        const light = new THREE.PointLight(0xffffff, 0, 16, 2);
        light.userData.lamp = null;
        lampLights.push(light);
        scene.add(light);
      }
      return lamp;
    },

    /** A ready-made thing from the catalog, standing on the ground at [x, y, z]. */
    thing(kind, { at = [0, 0, 0], turn = 0, scale = 1, style = "garden", solid = true } = {}) {
      const item = catalog[kind];
      if (!item) console.warn(`kit.thing: unknown kind "${kind}"`);
      const group = makeThing(kind, item ?? { size: [1, 1, 1] }, style, `${kind}${at.join(",")}`);
      group.traverse((part) => part.isMesh && (part.castShadow = part.receiveShadow = true));
      group.position.set(...at);
      group.rotation.y = turn;
      group.scale.setScalar(scale);
      scene.add(group);
      if (solid && item && !["rug", "flowers", "tall_grass"].includes(kind) && !item.portable) kit.solid(group);
      return group;
    },
    /** The names of all ready-made things. */
    things: Object.keys(catalog),

    /**
     * A real 3D model made by an artist: one from public/models (see manifest.json), or a scanned
     * Poly Haven model, "polyhaven/<id>", loaded from Poly Haven's servers. Async: await it.
     * It stands with the middle of its base at at. size sets the length of its longest side in
     * metres; otherwise scale multiplies its own size (Poly Haven models are already real size).
     */
    async model(name, { at = [0, 0, 0], turn = 0, size, scale = 1, solid = true, light = true } = {}) {
      const scanned = name.startsWith(POLYHAVEN) ? polyhaven?.models[name.slice(POLYHAVEN.length)] : null;
      let info = scanned ?? models[name];
      const group = new THREE.Group();
      let original = null;
      if (!info) console.warn(`kit.model: unknown model "${name}"`);
      else {
        loading[name] ??= (scanned ? polyhavenLoader(scanned).loadAsync(POLYHAVEN_FILES + scanned.gltf) : modelLoader.loadAsync(`${MODEL_ROOT}${info.file ?? `${name}.glb`}`)).then((gltf) => {
          // Scanned models come with their own real materials; keep only their most detailed version.
          if (scanned) gltf.scene.traverse((part) => /_LOD[1-9]/.test(part.name) && (part.visible = false));
          else prepareModel(gltf.scene, name.split("/")[0]);
          return gltf;
        });
        try {
          original = (await loading[name]).scene;
        } catch (error) {
          console.warn(`kit.model: "${name}" didn't load: ${error.message}`); // a network problem shouldn't stop the game
          info = null;
        }
      }
      if (info && original) {
        const copy = original.clone(true);
        copy.traverse((part) => part.isMesh && (part.castShadow = part.receiveShadow = true));
        const factor = size ? size / Math.max(...info.size) : scale;
        copy.scale.setScalar(factor);
        // Move the model so that the middle of its base sits at the group's origin.
        const [w, , d] = info.size;
        copy.position.set(-(info.min[0] + w / 2) * factor, -info.min[1] * factor, -(info.min[2] + d / 2) * factor);
        group.add(copy);
      }
      group.position.set(...at);
      group.rotation.y = turn;
      scene.add(group);
      if (solid && info && info.size[1] * (size ? size / Math.max(...info.size) : scale) > 0.3) kit.solid(group);
      if (light && scanned?.categories?.includes("lighting") && original) {
        // Real lamps give real light: near the top of a street lamp, or the middle of a small lamp.
        const tall = info.size[1] * (size ? size / Math.max(...info.size) : scale);
        group.userData.lamp = kit.lamp(group, { offset: [0, tall > 2 ? tall - 0.3 : tall * 0.6, 0], power: Math.min(1.6, Math.max(0.25, tall / 2.5)), reach: 6 + 3 * tall, bulb: false });
      }
      return group;
    },
    /** The names of all models, with their size at scale 1: { "racing/raceCarRed": { size: [w, h, d] }, ... }. */
    models,

    /**
     * A real scanned surface ("asphalt", "grass", "gravel" or any Poly Haven surface, "polyhaven/<id>")
     * for your own geometry. Its UVs should be in metres: one copy of the texture covers `metres` metres
     * (the surface's real size by default).
     */
    material(name, { metres, color } = {}) {
      name = knownSurface(name) ?? name;
      if (!isSurface(name)) console.warn(`kit.material: unknown surface "${name}"`);
      return realSurface(isSurface(name) ? name : "asphalt", 1 / (Number(metres) || surfaceMetres(name) || 4), color);
    },

    /**
     * A race track or road through the points [[x, z], ...]: real asphalt, white edge lines, red and
     * white kerbs and gravel at the corners, and a chequered start line at the first point.
     * Returns { length, width, pointAt(m), tangentAt(m), nearest(position) } so games can follow it:
     * nearest gives { offset (metres from the centre line, signed), along (metres from the start), progress (0 to 1) }.
     */
    road(points, { width = 12, closed = true, kerbs = true, startLine = true } = {}) {
      const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), closed, "centripetal");
      const length = curve.getLength();
      const count = Math.max(150, Math.round(length / 1.0));
      const samples = [];
      for (let i = 0; i <= count; i++) {
        const f = i / count;
        const tangent = curve.getTangentAt(f % 1).setY(0).normalize();
        samples.push({ point: curve.getPointAt(f % 1), tangent, side: new THREE.Vector3(tangent.z, 0, -tangent.x), along: f * length });
      }
      // How sharply the road bends at each point: corners get kerbs and gravel.
      const bend = samples.map((sample, i) => {
        const before = samples[(i - 4 + count) % count].tangent;
        const after = samples[(i + 4) % count].tangent;
        return Math.acos(Math.max(-1, Math.min(1, before.dot(after))));
      });
      const corner = bend.map((value, i) => [-6, -3, 0, 3, 6].some((d) => bend[(i + d + count) % count] > 0.12));
      const group = new THREE.Group();
      /** A strip along the road between two sideways offsets, with UVs in metres divided by `metres`. */
      const strip = (from, to, y, material, metres, only) => {
        const positions = [];
        const uvs = [];
        const indices = [];
        let vertex = 0;
        let joined = false;
        samples.forEach((sample, i) => {
          const keep = !only || only[i % count];
          if (keep) {
            for (const offset of [from, to]) {
              const p = sample.point.clone().addScaledVector(sample.side, offset);
              positions.push(p.x, y, p.z);
              uvs.push(offset / metres, sample.along / metres);
            }
            if (joined) indices.push(vertex - 2, vertex - 1, vertex, vertex - 1, vertex + 1, vertex);
            vertex += 2;
          }
          joined = keep;
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
      };
      const half = width / 2;
      strip(-half, half, 0.02, realSurface("asphalt", 1), 4);
      const paint = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.55, side: THREE.DoubleSide });
      strip(half - 0.55, half - 0.3, 0.026, paint, 1);
      strip(-half + 0.3, -half + 0.55, 0.026, paint, 1);
      if (kerbs) {
        const kerb = new THREE.MeshStandardMaterial({ map: stripes(["#d4141c", "#f2f2f2"]), roughness: 0.5, side: THREE.DoubleSide });
        strip(half, half + 1.3, 0.04, kerb, 3, corner);
        strip(-half - 1.3, -half, 0.04, kerb, 3, corner);
        const gravel = realSurface("gravel", 1);
        strip(half + 1.3, half + 10, 0.012, gravel, 3, corner);
        strip(-half - 10, -half - 1.3, 0.012, gravel, 3, corner);
      }
      if (startLine) {
        const holder = new THREE.Group();
        const line = new THREE.Mesh(new THREE.PlaneGeometry(width, 1.6), new THREE.MeshStandardMaterial({ map: stripes(["#111111", "#f2f2f2"], 16), roughness: 0.6 }));
        line.rotation.x = -Math.PI / 2;
        line.position.y = 0.03;
        line.receiveShadow = true;
        holder.add(line);
        holder.position.copy(samples[0].point);
        holder.rotation.y = Math.atan2(samples[0].tangent.x, samples[0].tangent.z);
        group.add(holder);
      }
      scene.add(group);
      return {
        group,
        curve,
        length,
        width,
        /** The centre line point m metres from the start (going round again after one lap). */
        pointAt: (m) => curve.getPointAt((((m / length) % 1) + 1) % 1),
        tangentAt: (m) => curve.getTangentAt((((m / length) % 1) + 1) % 1),
        nearest(position) {
          let best = samples[0];
          let bestDistance = Infinity;
          for (const sample of samples) {
            const d = (sample.point.x - position.x) ** 2 + (sample.point.z - position.z) ** 2;
            if (d < bestDistance) (bestDistance = d), (best = sample);
          }
          const offset = (position.x - best.point.x) * best.side.x + (position.z - best.point.z) * best.side.z;
          return { offset, distance: Math.abs(offset), along: best.along, progress: best.along / length, point: best.point, tangent: best.tangent, onRoad: Math.abs(offset) <= half };
        },
      };
    },

    /**
     * A detailed vehicle built in code. "f1": a Formula 1 car to real size (5.6 m), with options color,
     * accent, number, tyre ("soft", "medium" or "hard") and helmet. Returns car with car.root (move and
     * turn it; it faces +z), car.steer(angle) for the front wheels and car.roll(metres) to spin the wheels.
     */
    vehicle(type, { at = [0, 0, 0], turn = 0, solid, lights = false, siren = true, ...options } = {}) {
      const road = ROAD_CARS.includes(type);
      if (!road && type !== "f1") console.warn(`kit.vehicle: unknown type "${type}", using "sedan"`);
      const car = road || type !== "f1" ? buildRoadCar(road ? type : "sedan", options) : buildF1Car(options);
      car.root.position.set(...(Array.isArray(at) ? at : [at.x ?? 0, at.y ?? 0, at.z ?? 0]));
      car.root.rotation.y = turn;
      scene.add(car.root);
      if (car.flash) {
        // Headlights that light the road ahead, and a police car's flashing red and blue.
        const half = car.length / 2;
        car.headlights = lights ? [kit.lamp(car.root, { offset: [0, 0.8, half + 1.2], color: "#fff4e2", power: 0.8, reach: 22 })] : [];
        if (car.kind === "police") {
          car.sirenOn = siren; // set car.sirenOn = false to stop the flashing lights
          const flashes = [kit.lamp(car.root, { offset: [-0.4, 1.9, 0], color: "#ff2a2a", power: 0.7, reach: 14 }), kit.lamp(car.root, { offset: [0.4, 1.9, 0], color: "#2a5cff", power: 0.7, reach: 14 })];
          kit.onUpdate((dt, time) => {
            const lit = car.flash(time, car.sirenOn);
            flashes.forEach((lamp, i) => (lamp.on = lit === i));
          });
        }
        if (solid ?? true) kit.solid(car.root); // parked cars are solid; pass solid: false for cars that drive
      } else if (solid) kit.solid(car.root);
      return car;
    },

    /** Camera effects: speed (0 to 1) adds motion blur; vignette (0 to 1) darkens the corners. */
    effects: {
      get speed() {
        return lens.uniforms.speed.value;
      },
      set speed(value) {
        lens.uniforms.speed.value = Math.max(0, Math.min(1, value));
      },
      get vignette() {
        return lens.uniforms.vignette.value;
      },
      set vignette(value) {
        lens.uniforms.vignette.value = Math.max(0, Math.min(1, value));
      },
    },

    /**
     * An animated character: a real person (Rocketbox, such as "Police_Male_01"; see characters.js), a
     * stylised person (thief, kid, robot, guard, soldier, ghost) or a creature (ant, beetle, spider, bee,
     * dog, cat, mouse, bird). Move character.root yourself; call character.play("idle" | "walk" | "run")
     * to match how it moves. It faces +z when root.rotation.y is 0. Real people also have
     * character.speeds ({ walk, run } in m/s, matching their feet) and "crouch", "look", "cheer" and "talk".
     */
    character(look, { at = [0, 0, 0], color, scale = 1, turn = 0 } = {}) {
      const person = makeCharacter(look, color);
      person.root.position.set(...at);
      person.root.rotation.y = turn;
      person.root.scale.setScalar(scale);
      person.height *= scale;
      person.play = (name, timeScale) => play(person, name, timeScale);
      person.face = (x, z) => (person.root.rotation.y = Math.atan2(x - person.root.position.x, z - person.root.position.z));
      person.ready ??= Promise.resolve(); // real people: when their body has appeared
      scene.add(person.root);
      people.push(person);
      return person;
    },

    /** A floating text tag; returns a sprite you can move. */
    label(text, { at = [0, 2, 0], color = "#ffffff", size = 1 } = {}) {
      const sprite = makeLabel(text, { color, size });
      sprite.position.set(...at);
      scene.add(sprite);
      return sprite;
    },

    /** The camera chases target from behind (behind: true) or from a fixed side. */
    follow(target, { distance = 7, height = 3.5, behind = true, smooth = 5 } = {}) {
      view = target ? { kind: "follow", target, distance, height, behind, smooth } : null;
    },
    /** The camera looks down on target from above, like a top-down game. */
    overhead(target, { height = 18, back = 9, smooth = 5 } = {}) {
      view = target ? { kind: "overhead", target, height, back, smooth } : null;
    },
    /** The camera watches target from the side, like a platform game; the game runs along x. */
    side(target, { distance = 14, height = 3, smooth = 5 } = {}) {
      view = target ? { kind: "side", target, distance, height, smooth } : null;
    },

    sound(name) {
      try {
        audio ??= new AudioContext();
        SOUNDS[name]?.();
      } catch {
        // sound is optional
      }
    },

    /** A burst of glowing bits, for pickups, hits and explosions. */
    burst(at, { color = "#ffcc44", count = 24, speed = 4, size = 0.12, life = 0.8 } = {}) {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true });
      for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 4), material.clone());
        mesh.position.set(...(Array.isArray(at) ? at : [at.x, at.y, at.z]));
        const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
        scene.add(mesh);
        particles.push({ mesh, velocity, life, age: 0 });
      }
    },

    // Simple collisions ----------------------------------------------------
    /** Marks an object as solid: kit.slide won't move things through it. Call after placing it. */
    solid(object) {
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object);
      solids.push({ object, box });
      return box;
    },
    /**
     * Moves object by (dx, dz), sliding along solid things instead of going through them.
     * Returns true if it moved the whole way.
     */
    slide(object, dx, dz, radius = 0.4) {
      const p = object.position;
      const blocked = (x, z) =>
        solids.some(({ object: other, box, line }) => {
          if (other === object || box.max.y <= p.y + 0.15 || box.min.y >= p.y + 1.6) return false;
          if (!line) return x > box.min.x - radius && x < box.max.x + radius && z > box.min.z - radius && z < box.max.z + radius;
          return distanceToLine(x, z, line) < line.half + radius;
        });
      if (!blocked(p.x + dx, p.z + dz)) {
        p.x += dx;
        p.z += dz;
        return true;
      }
      if (!blocked(p.x + dx, p.z)) p.x += dx;
      else if (!blocked(p.x, p.z + dz)) p.z += dz;
      return false;
    },
    /** True when two objects' boxes overlap (grown by margin). */
    touching(a, b, margin = 0) {
      const boxA = new THREE.Box3().setFromObject(a).expandByScalar(margin);
      return boxA.intersectsBox(new THREE.Box3().setFromObject(b));
    },
    /** Distance between two objects on the ground, ignoring height. */
    distance(a, b) {
      const pa = a.position ?? a;
      const pb = b.position ?? b;
      return Math.hypot(pa.x - pb.x, pa.z - pb.z);
    },
    /** Removes an object from the game. */
    remove(object) {
      const lamp = lamps.find((each) => each === object || each.bulb === object || each.object === object);
      if (lamp) {
        lamps.splice(lamps.indexOf(lamp), 1);
        if (lamp.bulb) scene.remove(lamp.bulb);
        if (object === lamp) return;
      }
      scene.remove(object);
      const index = solids.findIndex((solid) => solid.object === object);
      if (index >= 0) solids.splice(index, 1);
    },

    /** Meta's world model for this game: kit.world({ about, state, can }). See live.js. */
    world: live.world,
    /** A mind of its own for a character: kit.mind({ name, about, sees, can, every, body }). */
    mind: live.mind,

    random: (min = 0, max = 1) => min + Math.random() * (max - min),
    pick: (list) => list[Math.floor(Math.random() * list.length)],

    win(message = "You win!") {
      if (kit.over) return;
      kit.over = true;
      hud.big(message, "Press R to play again");
      kit.sound("win");
      report({ kind: "win", message });
      live.roundOver("win", message);
    },
    lose(message = "Game over") {
      if (kit.over) return;
      kit.over = true;
      hud.big(message, "Press R to try again");
      kit.sound("lose");
      report({ kind: "lose", message });
      live.roundOver("lose", message);
    },
  };

  kit.sky("day");
  await loadCharacters();

  // The loop ---------------------------------------------------------------
  const clock = new THREE.Clock();
  let frames = 0;
  // A loading screen until the game has built its world: skies, models and people load from the internet.
  const bornAt = performance.now();
  let started = false; // the game's main(kit) has finished
  let startedFrames = 0;
  let readySent = false;
  const loadingScreen = document.createElement("div");
  loadingScreen.textContent = "Loading the world…";
  loadingScreen.style.cssText = "position:fixed;inset:0;display:grid;place-items:center;background:#05070b;color:#c9d3e0;font:600 15px system-ui,sans-serif;letter-spacing:.04em;z-index:50;transition:opacity .5s";
  document.body.append(loadingScreen);
  // Lamps: every 0.25 s the real lights go to the lamps nearest to what the camera looks at.
  let lampClock = 0;
  const lampSpot = new THREE.Vector3();
  const lookingAt = new THREE.Vector3();
  function placeLampLights(dt) {
    if (lampLights.length === 0) return;
    lampClock -= dt;
    if (lampClock <= 0) {
      lampClock = 0.25;
      camera.getWorldDirection(lookingAt).setY(0).normalize().multiplyScalar(12).add(camera.position).setY(0);
      const nearest = lamps
        .filter((lamp) => lamp.on && lamp.power > 0)
        .map((lamp) => ({ lamp, far: lamp.where(lampSpot).distanceTo(lookingAt) - lamp.reach * 0.5 }))
        .sort((a, b) => a.far - b.far)
        .slice(0, LAMP_LIGHTS);
      lampLights.forEach((light, i) => (light.userData.lamp = nearest[i]?.lamp ?? null));
    }
    for (const light of lampLights) {
      const lamp = light.userData.lamp;
      if (!lamp || !lamp.on || !lamps.includes(lamp)) {
        light.intensity = 0;
        continue;
      }
      lamp.where(light.position);
      light.color.copy(lamp.color);
      light.intensity = 90 * lamp.power; // candela: a street lamp's pool is far brighter than moonlight, as in life
      light.distance = lamp.reach;
    }
  }

  function step(dt) {
    kit.time += dt;
    for (const fn of [...updates]) {
      try {
        fn(dt, kit.time);
      } catch (error) {
        updates.delete(fn); // report a broken update once instead of every frame
        report({ kind: "error", message: `${error.message}\n${error.stack ?? ""}`.slice(0, 1500) });
      }
    }
    for (const timer of [...timers]) {
      if (kit.time < timer.at) continue;
      timers.splice(timers.indexOf(timer), 1);
      timer.fn();
    }
    for (const person of people) person.mixer?.update(dt); // real people get their mixer once they have loaded
    placeLampLights(dt);
    for (const bit of [...particles]) {
      bit.age += dt;
      bit.velocity.y -= 9.8 * dt;
      bit.mesh.position.addScaledVector(bit.velocity, dt);
      bit.mesh.material.opacity = 1 - bit.age / bit.life;
      if (bit.age >= bit.life) {
        scene.remove(bit.mesh);
        particles.splice(particles.indexOf(bit), 1);
      }
    }
    live.tick();
  }
  renderer.setAnimationLoop(() => {
    // While the player types for the world model, the game stands still.
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!paused) step(dt);
    updateView(paused ? 0 : dt);
    if (sun) {
      // The sun moves with the action, so shadows always cover what's on screen.
      const focus = view?.target?.position ?? new THREE.Vector3();
      sun.position.copy(focus).add(sun.userData.from);
      sun.target.position.copy(focus);
    }
    composer.render();
    pressed.clear();
    pointer.clicked = false;
    frames += 1;
    if (started) startedFrames += 1;
    // Ready once the game's world is built and on screen (or after 20 s, for a game that never finishes setting up).
    if (!readySent && (startedFrames >= 20 || (frames >= 30 && performance.now() - bornAt > 20_000))) {
      readySent = true;
      loadingScreen.style.opacity = "0";
      setTimeout(() => loadingScreen.remove(), 600);
      report({ kind: "ready" });
    }
  });
  // Called by the sandbox when the game's main(kit) has finished setting up.
  Object.defineProperty(kit, "started", { value: () => (started = true), enumerable: false });
  return kit;
}
