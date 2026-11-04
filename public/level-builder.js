// Builds any designed level in 3D from its layout: rooms on a grid, walls with doorways and doors,
// furniture from the catalog, lights and exits. Levels come from the designer (src/design/build.ts).
import * as THREE from "three";

const T = 0.14; // wall thickness
const GAP = 1.5; // width of a doorway
const DOOR_HEIGHT = 2.1;
const WALL_MOUNTED = new Set(["painting", "light_switch", "fuse_box"]);
const OUTDOOR = new Set(["forest", "garden"]); // no walls: open ground edged by hedges

/** Colours for each style the designer can choose. */
export const STYLES = {
  forest: { floor: 0x3f5a2e, pattern: "grass", wall: 0x2f4a24, trim: 0x5a4030, wood: 0x6b4a2e, dark: 0x3e2a1a, metal: 0x8f8a80, fabric: 0x5b7a3a, light: 0xffd89a, leaf: 0x3f7a3a },
  garden: { floor: 0x5f8a3a, pattern: "grass", wall: 0x3f6a2a, trim: 0x8a6a4a, wood: 0x9a6a3e, dark: 0x5a3b26, metal: 0xb2bac2, fabric: 0xd96a8a, light: 0xfff1d6, leaf: 0x4f9a3a },
  cave: { floor: 0x4a4640, pattern: "stone", wall: 0x5a554c, trim: 0x3a3630, wood: 0x5a4030, dark: 0x2a2420, metal: 0x7d7a70, fabric: 0x6a4a3a, light: 0xffb15a },
  home: { floor: 0x8a6a4a, pattern: "planks", wall: 0xd9cdb8, trim: 0x6b5643, wood: 0x8a5a36, dark: 0x5a3b26, metal: 0x9aa3ad, fabric: 0x2f6f73, light: 0xffc27a },
  museum: { floor: 0xd9d4ca, pattern: "tiles", wall: 0xf1ede5, trim: 0xb59a5a, wood: 0x7a4f2e, dark: 0x4a3322, metal: 0xc9a44c, fabric: 0x7a1f2b, light: 0xfff1d6 },
  office: { floor: 0x55606b, pattern: "carpet", wall: 0xbfc6cd, trim: 0x39424c, wood: 0xa98a64, dark: 0x3a3f46, metal: 0xaab3bc, fabric: 0x3b5b8a, light: 0xe8f0ff },
  prison: { floor: 0x707274, pattern: "concrete", wall: 0x8c9094, trim: 0x4c5054, wood: 0x6b5a48, dark: 0x3c3f42, metal: 0x7d858c, fabric: 0x9a7a3a, light: 0xdfe8d8 },
  castle: { floor: 0x6b6358, pattern: "stone", wall: 0x8a7f70, trim: 0x4e463c, wood: 0x6a4428, dark: 0x3e2a1a, metal: 0x8f8a80, fabric: 0x5b1f2a, light: 0xffb15a },
  lab: { floor: 0xe3e9ec, pattern: "tiles", wall: 0xf3f6f7, trim: 0x7f97a8, wood: 0xb8c4cc, dark: 0x4a5560, metal: 0xc8d2d9, fabric: 0x2e7d9a, light: 0xe8fbff },
  school: { floor: 0x9fb08a, pattern: "tiles", wall: 0xe8dcc0, trim: 0x5a7a54, wood: 0xa57a4c, dark: 0x5e4630, metal: 0x8a98a5, fabric: 0x2f5f8a, light: 0xfff4dc },
  shop: { floor: 0xcfc6b6, pattern: "tiles", wall: 0xe9e2d5, trim: 0xb8433a, wood: 0x9a6a3e, dark: 0x4e3a2a, metal: 0xb2bac2, fabric: 0xb8433a, light: 0xfff6e0 },
  warehouse: { floor: 0x6d6a64, pattern: "concrete", wall: 0x7c838a, trim: 0xd9a441, wood: 0x9a7448, dark: 0x4a3a2a, metal: 0x8a939b, fabric: 0x3f5f3f, light: 0xf2f0e0 },
  haunted: { floor: 0x3f3328, pattern: "planks", wall: 0x4f4a40, trim: 0x2a2520, wood: 0x4a3626, dark: 0x2a1e15, metal: 0x6c6a60, fabric: 0x3b2440, light: 0x9fd6c8 },
};

// ---------------------------------------------------------------------------
// Small helpers

/** A seeded random, so a level looks the same every time it loads. */
function seeded(text) {
  let seed = 7;
  for (const char of text) seed = (seed * 31 + char.charCodeAt(0)) % 2147483647;
  seed = 1 + (seed % 2147483646);
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...options });

/** A box from its size, the centre of its footprint and the height of its bottom face. */
function block(parent, w, h, d, material, x = 0, bottom = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, bottom + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function round(parent, top, bottom, h, material, x = 0, base = 0, z = 0, open = false) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, h, 20, 1, open), material);
  mesh.position.set(x, base + h / 2, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function ball(parent, r, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** A rough, faceted lump for leaves and stones. */
function lump(parent, r, material, x, y, z, scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), material);
  mesh.position.set(x, y, z);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

const corners = (w, d) => [
  [-w / 2, -d / 2],
  [w / 2, -d / 2],
  [-w / 2, d / 2],
  [w / 2, d / 2],
];

function canvasTexture(size, draw) {
  const surface = document.createElement("canvas");
  surface.width = surface.height = size;
  draw(surface.getContext("2d"), size);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const rgb = (hex, shade = 1) => `rgb(${(((hex >> 16) & 255) * shade) | 0}, ${(((hex >> 8) & 255) * shade) | 0}, ${((hex & 255) * shade) | 0})`;

function floorTexture(pattern, color, random) {
  return canvasTexture(256, (g, size) => {
    g.fillStyle = rgb(color);
    g.fillRect(0, 0, size, size);
    if (pattern === "planks") {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = rgb(color, 0.82 + random() * 0.3);
        g.fillRect(i * 32, 0, 32, size);
        g.fillStyle = "rgba(0, 0, 0, 0.35)";
        g.fillRect(i * 32, 0, 2, size);
        g.fillRect(i * 32, random() * size, 32, 2);
      }
    } else if (pattern === "grass") {
      for (let i = 0; i < 1400; i++) {
        g.fillStyle = rgb(color, 0.7 + random() * 0.5);
        g.fillRect(random() * size, random() * size, 2, 3 + random() * 7);
      }
    } else if (pattern === "tiles" || pattern === "stone") {
      const count = pattern === "tiles" ? 4 : 3;
      const step = size / count;
      for (let x = 0; x < count; x++) {
        for (let y = 0; y < count; y++) {
          g.fillStyle = rgb(color, 0.9 + random() * 0.15);
          g.fillRect(x * step + 2, y * step + 2, step - 4, step - 4);
        }
      }
    } else {
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(${random() > 0.5 ? "255, 255, 255" : "0, 0, 0"}, ${0.04 + random() * 0.06})`;
        const spot = pattern === "concrete" ? 2 + random() * 10 : 2;
        g.fillRect(random() * size, random() * size, spot, spot);
      }
    }
  });
}

/** A text tag that always faces the camera. */
export function label(text, { color = "#e7ecf5", background = "rgba(11, 15, 23, 0.78)", size = 1 } = {}) {
  const surface = document.createElement("canvas");
  const g = surface.getContext("2d");
  g.font = "600 40px system-ui, sans-serif";
  surface.width = Math.ceil(g.measureText(text).width) + 36;
  surface.height = 64;
  g.font = "600 40px system-ui, sans-serif";
  g.fillStyle = background;
  g.beginPath();
  g.roundRect(0, 0, surface.width, surface.height, 18);
  g.fill();
  g.fillStyle = color;
  g.textBaseline = "middle";
  g.fillText(text, 18, 34);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set((surface.width / surface.height) * 0.42 * size, 0.42 * size, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// ---------------------------------------------------------------------------
// Furniture and things, one maker per catalog kind. Each draws into a group whose origin is the
// middle of its footprint on the floor, with its front facing +z. It returns the height things can
// be put on, if any.

const BOOK_COLORS = [0xb84a3e, 0x3e6db8, 0xd9a441, 0x4f8a5b, 0x8d5fb8, 0xe0d6c2];

function materialsFor(style) {
  const p = STYLES[style] ?? STYLES.home;
  return {
    palette: p,
    wall: mat(p.wall),
    cap: mat(p.trim),
    trim: mat(p.trim),
    wood: mat(p.wood),
    plank: mat(0xb08a5a),
    dark: mat(p.dark),
    metal: mat(p.metal, { metalness: 0.6, roughness: 0.4 }),
    fabric: mat(p.fabric, { roughness: 0.95 }),
    white: mat(0xeeeae2),
    paper: mat(0xf3ecd8),
    black: mat(0x1d2026, { roughness: 0.5 }),
    stone: mat(style === "museum" ? 0xf2efe8 : style === "haunted" ? 0x7d7a70 : 0xa7a39b),
    gold: mat(0xd9a441, { metalness: 0.9, roughness: 0.25 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false }),
    carGlass: mat(0x1b2633, { metalness: 0.3, roughness: 0.2 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0b1424, emissive: 0x5fa8ff, emissiveIntensity: 1.4 }),
    gem: new THREE.MeshStandardMaterial({ color: 0xdff6ff, emissive: 0x7fd8ff, emissiveIntensity: 1.2, metalness: 0.2, roughness: 0.05 }),
    shade: new THREE.MeshStandardMaterial({ color: 0xf3d9a8, emissive: p.light, emissiveIntensity: 1.1, side: THREE.DoubleSide }),
    ledGreen: new THREE.MeshBasicMaterial({ color: 0x4cff8a }),
    ledBlue: new THREE.MeshBasicMaterial({ color: 0x4fc3ff }),
    warning: mat(0xf2c14e),
    leaf: mat(0x3f7a3a),
    pot: mat(0x8a4a2e),
    porcelain: mat(0xe8eef8),
    bottle: new THREE.MeshStandardMaterial({ color: 0x3f8a5b, transparent: true, opacity: 0.75, roughness: 0.1 }),
    leather: mat(0x4a2f1e),
    toy: mat(0xe05a4f),
    keycard: mat(0x3e6db8),
    books: BOOK_COLORS.map((color) => mat(color)),
    rug: mat(p.fabric, { roughness: 1 }),
    bark: mat(0x6b4a2e, { roughness: 1 }),
    barkInside: mat(0x3a2616, { roughness: 1 }),
    canopy: mat(p.leaf ?? 0x4f8a3a, { flatShading: true }),
    hedge: mat(p.wall, { flatShading: true, roughness: 1 }),
    stoneLump: mat(0x8a8780, { flatShading: true }),
    capRed: mat(0xc0392b),
    petals: [0xe05a8a, 0xf2c14e, 0xffffff, 0x8d5fb8].map((color) => mat(color)),
    berry: mat(0x8e1f4a, { roughness: 0.3 }),
  };
}

const MAKERS = {
  bed(g, [w, d], m) {
    block(g, w, 0.35, d, m.dark);
    block(g, w - 0.08, 0.18, d - 0.12, m.white, 0, 0.35, 0.03);
    block(g, w - 0.02, 0.07, d * 0.55, m.fabric, 0, 0.5, d * 0.2);
    block(g, w * 0.7, 0.1, 0.32, m.white, 0, 0.53, -d / 2 + 0.3);
    block(g, w, 0.95, 0.08, m.dark, 0, 0, -d / 2 + 0.04);
    return 0.6;
  },
  sofa(g, [w, d, h], m) {
    block(g, w, 0.42, d, m.fabric);
    block(g, w, h - 0.42, 0.22, m.fabric, 0, 0.42, -d / 2 + 0.11);
    for (const x of [-w / 2 + 0.09, w / 2 - 0.09]) block(g, 0.18, 0.62, d, m.fabric, x);
    return 0.42;
  },
  wardrobe(g, [w, d, h], m) {
    block(g, w, h, d, m.wood);
    block(g, 0.015, h - 0.15, 0.01, m.dark, 0, 0.08, d / 2 + 0.005);
    for (const x of [-0.06, 0.06]) block(g, 0.03, 0.12, 0.03, m.gold, x, h / 2, d / 2 + 0.02);
  },
  desk(g, [w, d, h], m) {
    block(g, w, 0.05, d, m.wood, 0, h - 0.05);
    for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) block(g, 0.05, h - 0.05, d, m.dark, x);
    block(g, 0.42, 0.22, d - 0.05, m.dark, w / 2 - 0.26, h - 0.28);
    return h;
  },
  table(g, [w, d, h], m) {
    block(g, w, 0.06, d, m.wood, 0, h - 0.06);
    for (const [x, z] of corners(w - 0.12, d - 0.12)) block(g, 0.06, h - 0.06, 0.06, m.dark, x, 0, z);
    return h;
  },
  counter(g, [w, d, h], m) {
    block(g, w, h - 0.05, d, m.trim);
    block(g, w + 0.04, 0.05, d + 0.04, m.white, 0, h - 0.05);
    return h;
  },
  crates(g, [w, , h], m, random) {
    const s = w / 2;
    const crate = (x, y, z, size, turn) => {
      const mesh = block(g, size, size, size, random() > 0.5 ? m.wood : m.plank, x, y, z);
      mesh.rotation.y = turn;
    };
    crate(-s / 2, 0, -s / 2, s * 0.96, 0);
    crate(s / 2, 0, -s / 2, s * 0.96, 0.08);
    crate(-s / 2, 0, s / 2, s * 0.96, -0.05);
    crate(-s / 4, s * 0.96, -s / 4, s * 0.9, 0.25);
    if (h > 2 * s) crate(-s / 4, s * 1.86, -s / 4, h - s * 1.86, -0.2);
  },
  barrels(g, [w], m) {
    const r = w / 4.2;
    for (const [x, z] of [[-r, -r * 0.6], [r, -r * 0.6], [0, r * 1.1]]) {
      round(g, r, r, 1.0, m.dark, x, 0, z);
      for (const y of [0.15, 0.8]) round(g, r + 0.01, r + 0.01, 0.05, m.metal, x, y, z);
    }
  },
  lockers(g, [w, d, h], m) {
    const each = w / 3;
    for (let i = 0; i < 3; i++) {
      const x = -w / 2 + each * (i + 0.5);
      block(g, each - 0.02, h, d, m.metal, x);
      for (let v = 0; v < 3; v++) block(g, each * 0.5, 0.02, 0.01, m.black, x, h - 0.25 - v * 0.06, d / 2 + 0.005);
      block(g, 0.03, 0.12, 0.02, m.black, x + each * 0.3, h * 0.5, d / 2 + 0.01);
    }
  },
  statue(g, [w, , h], m) {
    block(g, w, 0.5, w, m.stone);
    round(g, 0.2, 0.3, 1.2, m.stone, 0, 0.5, 0);
    block(g, 0.7, 0.16, 0.2, m.stone, 0, 1.45, 0);
    ball(g, 0.17, m.stone, 0, h - 0.3, 0);
  },
  curtains(g, [w, d, h], m) {
    block(g, w + 0.2, 0.04, 0.04, m.metal, 0, h - 0.04, -d / 2 + 0.02);
    const folds = 7;
    for (let i = 0; i < folds; i++) block(g, w / folds + 0.02, h - 0.1, 0.08, m.fabric, -w / 2 + (w / folds) * (i + 0.5), 0.02, i % 2 ? 0.02 : -0.03);
  },
  server_rack(g, [w, d, h], m, random) {
    block(g, w, h, d, m.black);
    for (let i = 0; i < 14; i++) {
      const led = block(g, 0.04, 0.02, 0.01, random() > 0.5 ? m.ledGreen : m.ledBlue, -w / 2 + 0.12 + random() * (w - 0.24), 0.2 + i * 0.12, d / 2 + 0.006);
      led.castShadow = false;
    }
  },
  car(g, [w, d], m, random) {
    const paint = mat([0xb8433a, 0x2f5f8a, 0xd9a441, 0x3f7a3a][Math.floor(random() * 4)], { metalness: 0.5, roughness: 0.35 });
    block(g, w, 0.62, d, paint, 0, 0.28);
    block(g, w * 0.86, 0.5, d * 0.48, m.carGlass, 0, 0.9, -0.1);
    for (const [x, z] of corners(w - 0.1, d - 1.2)) {
      const wheel = round(g, 0.33, 0.33, 0.24, m.black, x, 0, z);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.y = 0.33;
    }
    return 0.9;
  },
  // Nature
  tree(g, [w, , h], m, random) {
    const trunk = w * 0.13;
    round(g, trunk * 0.75, trunk * 1.1, h * 0.62, m.bark);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + random() * 0.5;
      round(g, 0.02, trunk * 0.55, trunk * 1.5, m.bark, Math.cos(angle) * trunk * 0.95, 0, Math.sin(angle) * trunk * 0.95); // root flares
    }
    for (const [x, y, z, r] of [[0, 0.78, 0, 0.34], [0.22, 0.68, 0.1, 0.25], [-0.2, 0.7, -0.1, 0.26], [0.05, 0.9, -0.15, 0.22], [-0.1, 0.64, 0.22, 0.22]]) {
      lump(g, w * r, m.canopy, w * x, h * y, w * z);
    }
  },
  bush(g, [w, , h], m) {
    for (const [x, y, z, r] of [[0, 0.5, 0, 0.42], [0.25, 0.38, 0.12, 0.3], [-0.22, 0.36, -0.1, 0.32]]) lump(g, w * r, m.canopy, w * x, h * y, w * z);
  },
  rock(g, [w, d, h], m) {
    lump(g, 0.5, m.stoneLump, 0, h * 0.42, 0, [w, h * 0.9, d]);
    lump(g, 0.22, m.stoneLump, w * 0.38, 0.18, d * 0.3, [w * 0.6, 0.6, d * 0.6]);
  },
  log(g, [w, d], m) {
    const body = round(g, d / 2, d / 2, w, m.bark);
    body.rotation.z = Math.PI / 2;
    body.position.y = d / 2;
    for (const side of [-1, 1]) {
      const hole = round(g, d * 0.34, d * 0.34, 0.02, m.barkInside);
      hole.rotation.z = Math.PI / 2;
      hole.position.set((side * w) / 2 + side * 0.01, d / 2, 0);
    }
  },
  tall_grass(g, [w, d, h], m, random) {
    for (let i = 0; i < 26; i++) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.06, h * (0.6 + random() * 0.5), 4), m.canopy);
      blade.position.set((random() - 0.5) * w, (h * 0.5) / 2, (random() - 0.5) * d);
      blade.rotation.set((random() - 0.5) * 0.4, 0, (random() - 0.5) * 0.4);
      blade.castShadow = true;
      g.add(blade);
    }
  },
  mushroom(g, [w, , h], m, random) {
    round(g, w * 0.12, w * 0.16, h * 0.7, m.white);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(w / 2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.capRed);
    cap.position.y = h * 0.62;
    cap.scale.y = 0.75;
    cap.castShadow = true;
    g.add(cap);
    for (let i = 0; i < 7; i++) {
      const angle = random() * Math.PI * 2;
      const up = 0.3 + random() * 0.6;
      ball(g, w * 0.05, m.white, Math.cos(angle) * Math.cos(up) * w * 0.47, h * 0.62 + Math.sin(up) * w * 0.36, Math.sin(angle) * Math.cos(up) * w * 0.47);
    }
  },
  flowers(g, [w, d, h], m, random) {
    for (let i = 0; i < 12; i++) {
      const x = (random() - 0.5) * w;
      const z = (random() - 0.5) * d;
      round(g, 0.01, 0.01, h, m.canopy, x, 0, z);
      ball(g, 0.06, m.petals[Math.floor(random() * m.petals.length)], x, h, z);
    }
  },
  bookshelf(g, [w, d, h], m, random) {
    block(g, w, h, 0.04, m.dark, 0, 0, -d / 2 + 0.02);
    for (const x of [-w / 2 + 0.02, w / 2 - 0.02]) block(g, 0.04, h, d, m.dark, x);
    const shelves = 4;
    const gap = (h - 0.04) / shelves;
    for (let i = 0; i <= shelves; i++) block(g, w, 0.04, d, m.dark, 0, i * gap);
    for (let i = 0; i < shelves; i++) {
      for (let x = -w / 2 + 0.06; x < w / 2 - 0.12; ) {
        const thick = 0.04 + random() * 0.05;
        const book = block(g, thick, 0.22 + random() * 0.14, d * 0.75, m.books[Math.floor(random() * m.books.length)], x + thick / 2, 0.04 + i * gap, 0.02);
        book.castShadow = false;
        x += thick + 0.006;
      }
    }
  },
  cabinet(g, [w, d, h], m) {
    block(g, w, h, d, m.wood);
    for (const x of [-w / 4, w / 4]) block(g, 0.1, 0.03, 0.03, m.gold, x, h - 0.2, d / 2 + 0.015);
    return h;
  },
  display_case(g, [w, d, h], m) {
    // A slim stand with a glass box on top, framed in metal.
    block(g, w, 0.12, d, m.dark, 0, 0.78);
    for (const [x, z] of corners(w - 0.12, d - 0.12)) block(g, 0.06, 0.78, 0.06, m.dark, x, 0, z);
    const gw = w * 0.92;
    const gd = d * 0.92;
    block(g, gw, h - 0.9, gd, m.glass, 0, 0.9);
    for (const [x, z] of corners(gw, gd)) block(g, 0.03, h - 0.9, 0.03, m.metal, x, 0.9, z);
    for (const z of [-gd / 2, gd / 2]) block(g, gw, 0.03, 0.03, m.metal, 0, h - 0.03, z);
    for (const x of [-gw / 2, gw / 2]) block(g, 0.03, 0.03, gd, m.metal, x, h - 0.03, 0);
    return 0.9; // things inside it sit on the stand
  },
  pedestal(g, [w, , h], m) {
    block(g, w * 0.75, h - 0.1, w * 0.75, m.stone);
    block(g, w, 0.1, w, m.stone, 0, h - 0.1);
    return h;
  },
  fridge(g, [w, d, h], m) {
    block(g, w, h, d, m.white);
    block(g, w, 0.015, 0.01, m.metal, 0, h * 0.62, d / 2 + 0.005);
    block(g, 0.03, 0.4, 0.04, m.metal, w / 2 - 0.08, h * 0.7, d / 2 + 0.02);
  },
  plant(g, [w], m) {
    round(g, w * 0.4, w * 0.3, 0.45, m.pot);
    for (const [x, y, z, r] of [[0, 0.9, 0, 0.32], [0.12, 1.2, 0.05, 0.24], [-0.1, 1.15, -0.08, 0.22]]) ball(g, r, m.leaf, x, y, z);
  },
  rug(g, [w, d], m) {
    block(g, w, 0.015, d, m.rug).castShadow = false;
    block(g, w - 0.3, 0.017, d - 0.3, m.trim).castShadow = false;
    block(g, w - 0.4, 0.019, d - 0.4, m.rug).castShadow = false;
  },
  bench(g, [w, d, h], m) {
    block(g, w, 0.06, d, m.wood, 0, h - 0.06);
    for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) block(g, 0.08, h - 0.06, d - 0.06, m.dark, x);
    return h;
  },
  lamp(g, [w, , h], m) {
    if (m.palette.leaf) {
      // Outdoors: a wooden post with a glowing lantern.
      round(g, 0.05, 0.06, h - 0.2, m.bark);
      ball(g, 0.14, m.shade, 0, h - 0.1, 0).castShadow = false;
      return;
    }
    round(g, w * 0.35, w * 0.4, 0.04, m.black);
    round(g, 0.015, 0.015, h - 0.3, m.black, 0, 0.04);
    round(g, 0.13, 0.22, 0.3, m.shade, 0, h - 0.32, 0, true).castShadow = false;
  },
  // Wall-mounted: the origin is on the wall at floor level.
  light_switch(g, size, m) {
    block(g, 0.08, 0.12, 0.02, m.white, 0, 1.2, 0.01);
  },
  fuse_box(g, size, m) {
    block(g, 0.5, 0.7, 0.16, m.metal, 0, 1.0, 0.08);
    block(g, 0.5, 0.06, 0.17, m.warning, 0, 1.62, 0.085);
  },
  painting(g, [w, , h], m, random) {
    block(g, w, h, 0.05, m.gold, 0, 1.25, 0.025);
    const art = canvasTexture(128, (p, size) => {
      p.fillStyle = rgb([0x2f5d62, 0x6b2737, 0x3e6db8][Math.floor(random() * 3)]);
      p.fillRect(0, 0, size, size);
      for (let i = 0; i < 6; i++) {
        p.fillStyle = rgb(BOOK_COLORS[Math.floor(random() * BOOK_COLORS.length)]);
        p.beginPath();
        p.arc(random() * size, random() * size, 10 + random() * 26, 0, Math.PI * 2);
        p.fill();
      }
    });
    block(g, w - 0.12, h - 0.12, 0.01, new THREE.MeshStandardMaterial({ map: art, roughness: 0.9 }), 0, 1.31, 0.055);
  },
  // Small things that sit on furniture or the floor.
  laptop(g, size, m) {
    block(g, 0.36, 0.02, 0.25, m.metal);
    const screen = block(g, 0.36, 0.24, 0.012, m.screen, 0, 0.01, -0.12);
    screen.rotation.x = -0.28;
  },
  gem(g, size, m) {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), m.gem);
    gem.position.y = 0.1;
    gem.scale.y = 1.3;
    g.add(gem);
  },
  statuette(g, size, m) {
    round(g, 0.05, 0.08, 0.25, m.gold);
    ball(g, 0.06, m.gold, 0, 0.3, 0);
  },
  crown(g, size, m) {
    round(g, 0.11, 0.1, 0.08, m.gold, 0, 0, 0, true);
    for (let i = 0; i < 6; i++) {
      const point = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 6), m.gold);
      point.position.set(Math.cos((i * Math.PI) / 3) * 0.105, 0.11, Math.sin((i * Math.PI) / 3) * 0.105);
      g.add(point);
    }
    ball(g, 0.02, m.gem, 0, 0.05, 0.11);
  },
  gold(g, size, m) {
    block(g, 0.25, 0.08, 0.1, m.gold, 0, 0, -0.06);
    block(g, 0.25, 0.08, 0.1, m.gold, 0, 0, 0.06);
    block(g, 0.25, 0.08, 0.1, m.gold, 0, 0.08, 0);
  },
  documents(g, size, m) {
    block(g, 0.3, 0.02, 0.22, m.keycard);
    block(g, 0.28, 0.012, 0.2, m.paper, 0, 0.02);
  },
  keycard(g, size, m) {
    block(g, 0.09, 0.008, 0.06, m.keycard);
  },
  briefcase(g, size, m) {
    block(g, 0.45, 0.33, 0.12, m.leather);
    block(g, 0.14, 0.04, 0.03, m.black, 0, 0.33, 0);
  },
  vase(g, size, m) {
    round(g, 0.07, 0.12, 0.45, m.porcelain);
  },
  bottle(g, size, m) {
    round(g, 0.035, 0.04, 0.22, m.bottle);
    round(g, 0.012, 0.015, 0.08, m.bottle, 0, 0.22);
  },
  mug(g, size, m) {
    round(g, 0.05, 0.045, 0.11, m.white);
  },
  book(g, size, m) {
    block(g, 0.2, 0.04, 0.15, m.books[0]);
  },
  shoe(g, size, m) {
    block(g, 0.11, 0.08, 0.28, m.black);
    block(g, 0.1, 0.07, 0.12, m.black, 0, 0.07, -0.08);
  },
  toy(g, size, m) {
    ball(g, 0.08, m.toy, 0, 0.08, 0);
  },
  pillow(g, size, m) {
    block(g, 0.5, 0.12, 0.35, m.white);
  },
  leaf(g, size, m) {
    ball(g, 0.25, m.canopy, 0, 0.03, 0).scale.set(1, 0.08, 0.6);
  },
  berry(g, size, m) {
    ball(g, 0.08, m.berry, 0, 0.08, 0);
  },
  acorn(g, size, m) {
    ball(g, 0.06, m.bark, 0, 0.07, 0).scale.y = 1.25;
    ball(g, 0.065, m.barkInside, 0, 0.12, 0).scale.y = 0.5;
  },
};

/** One thing from the catalog, on its own, for games that build their own worlds (see kit/kit.js). */
const sharedMaterials = new Map();

export function makeThing(kind, item, style = "home", seed = kind) {
  const group = new THREE.Group();
  if (!sharedMaterials.has(style)) sharedMaterials.set(style, materialsFor(style));
  const maker = MAKERS[kind] ?? ((g, [w, d, h], m) => block(g, w, h, d, m.wood));
  maker(group, item.size, sharedMaterials.get(style), seeded(seed));
  return group;
}

export { floorTexture };

/** A thing the designer drew itself from simple shapes. */
function drawParts(g, parts) {
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.SphereGeometry(0.5, 18, 12),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
    cone: new THREE.ConeGeometry(0.5, 1, 20),
  };
  for (const part of parts) {
    const mesh = new THREE.Mesh(geometries[part.shape] ?? geometries.box, mat(new THREE.Color(part.color)));
    mesh.position.set(part.x, part.y, part.z);
    mesh.scale.set(part.w, part.h, part.d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
}

// Things the target and other small things can sit on, best first.
const SHOWCASES = ["display_case", "pedestal", "table", "desk", "counter", "cabinet"];
const SURFACES = ["table", "desk", "counter", "cabinet", "bench", "bed", "pedestal", "sofa", "car"];

// ---------------------------------------------------------------------------
// The building

/**
 * Builds the level into one group. Returns what the game needs: where each zone, door, exit and object
 * is, which meshes block sight and walking, and the lights.
 */
export function buildLevel(room, catalog, { cutaway = false, labels = true } = {}) {
  const layout = room.layout;
  const random = seeded(room.id);
  const m = materialsFor(layout.style);
  const palette = m.palette;
  const outdoor = OUTDOOR.has(layout.style);
  const wallHeight = cutaway ? 1.15 : 2.6;
  const root = new THREE.Group();
  const blockers = [];
  const obstacles = [];
  const walls = [];

  // Grid cells to metres, with the building centred on the origin.
  const { cell, areas } = layout;
  const left = Math.min(...areas.map((area) => area.col));
  const top = Math.min(...areas.map((area) => area.row));
  const right = Math.max(...areas.map((area) => area.col + area.width));
  const bottom = Math.max(...areas.map((area) => area.row + area.depth));
  const X = (col) => (col - (left + right) / 2) * cell;
  const Z = (row) => (row - (top + bottom) / 2) * cell;
  const owner = new Map();
  for (const area of areas) {
    for (let c = area.col; c < area.col + area.width; c++) for (let r = area.row; r < area.row + area.depth; r++) owner.set(`${c},${r}`, area.zone);
  }
  const at = (c, r) => owner.get(`${c},${r}`);

  const zones = new Map(
    areas.map((area) => {
      const zone = room.zones.find((z) => z.id === area.zone);
      const rect = { x0: X(area.col), x1: X(area.col + area.width), z0: Z(area.row), z1: Z(area.row + area.depth) };
      return [area.zone, { ...rect, cx: (rect.x0 + rect.x1) / 2, cz: (rect.z0 + rect.z1) / 2, name: zone?.name ?? area.zone, exit: Boolean(zone?.exit) }];
    }),
  );

  if (outdoor) for (const zone of zones.values()) zone.inset = 0.32; // hedges are thicker than walls

  // Base and floors.
  const base = block(root, X(right) - X(left) + 1.2, 0.45, Z(bottom) - Z(top) + 1.2, mat(outdoor ? 0x2a2016 : 0x161c29), 0, -0.45, 0);
  base.castShadow = false;
  const floorMap = floorTexture(palette.pattern, palette.floor, random);
  for (const [id, zone] of zones) {
    const map = floorMap.clone();
    map.repeat.set((zone.x1 - zone.x0) / 2, (zone.z1 - zone.z0) / 2);
    map.needsUpdate = true;
    const shade = 0.9 + random() * 0.2;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.x1 - zone.x0, zone.z1 - zone.z0),
      new THREE.MeshStandardMaterial({ map, color: new THREE.Color(shade, shade, shade), roughness: 0.85 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(zone.cx, 0.001, zone.cz);
    floor.receiveShadow = true;
    floor.userData.zone = id;
    root.add(floor);
  }

  // Wall lines: every cell edge with a different room (or the outside) on each side, merged into runs.
  const pieces = [];
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c < right; c++) if (at(c, r - 1) !== at(c, r)) pieces.push({ axis: "x", line: Z(r), from: X(c), to: X(c + 1), sides: [at(c, r - 1), at(c, r)] });
  }
  for (let c = left; c <= right; c++) {
    for (let r = top; r < bottom; r++) if (at(c - 1, r) !== at(c, r)) pieces.push({ axis: "z", line: X(c), from: Z(r), to: Z(r + 1), sides: [at(c - 1, r), at(c, r)] });
  }
  const runs = [];
  pieces.sort((a, b) => a.axis.localeCompare(b.axis) || a.line - b.line || a.from - b.from);
  for (const piece of pieces) {
    const last = runs.at(-1);
    if (last && last.axis === piece.axis && last.line === piece.line && last.to === piece.from && last.sides[0] === piece.sides[0] && last.sides[1] === piece.sides[1]) last.to = piece.to;
    else runs.push({ ...piece, gaps: [] });
  }
  const between = (a, b) => runs.filter((run) => run.sides.includes(a) && run.sides.includes(b)).sort((p, q) => q.to - q.from - (p.to - p.from))[0];
  const pointOn = (run, along, offset = 0) => (run.axis === "x" ? { x: along, z: run.line + offset } : { x: run.line + offset, z: along });

  const doors = [];
  for (const door of layout.doors) {
    const run = between(door.from, door.to);
    if (!run) continue;
    const center = (run.from + run.to) / 2;
    run.gaps.push({ center, kind: door.kind });
    doors.push({ ...door, ...pointOn(run, center), axis: run.axis });
  }
  const exits = [];
  for (const [id, zone] of zones) {
    if (!zone.exit) continue;
    const run = between(id, undefined);
    if (!run) continue;
    const center = (run.from + run.to) / 2;
    run.gaps.push({ center, kind: "exit" });
    const outward = run.sides[0] === undefined ? -1 : 1;
    exits.push({ zone: id, ...pointOn(run, center), outside: pointOn(run, center, outward * 0.9), axis: run.axis });
  }

  // Draw each run, leaving the gaps open. Outdoors the walls are hedges: taller around the edge,
  // low between areas, and too low to block the view.
  const wallMat = outdoor ? m.hedge : m.wall;
  const thick = outdoor ? 0.5 : T;
  for (const run of runs) {
    const height = outdoor ? (run.sides.includes(undefined) ? 1.0 : 0.55) : wallHeight;
    const cuts = run.gaps.map((gap) => [gap.center - GAP / 2, gap.center + GAP / 2]).sort((a, b) => a[0] - b[0]);
    let start = run.from - thick / 2;
    for (const [cutFrom, cutTo] of [...cuts, [run.to + thick / 2, Infinity]]) {
      const length = cutFrom - start;
      if (length > 0.01) {
        const middle = start + length / 2;
        const { x, z } = pointOn(run, middle);
        const mesh = block(root, run.axis === "x" ? length : thick, height, run.axis === "x" ? thick : length, wallMat, x, 0, z);
        if (!outdoor) blockers.push(mesh);
        walls.push(mesh);
        obstacles.push(run.axis === "x" ? [start, run.line - thick / 2, cutFrom, run.line + thick / 2] : [run.line - thick / 2, start, run.line + thick / 2, cutFrom]);
        if (cutaway && !outdoor) {
          const cap = block(root, run.axis === "x" ? length : T + 0.01, 0.03, run.axis === "x" ? T + 0.01 : length, m.cap, x, wallHeight, z);
          cap.castShadow = false;
        }
      }
      start = cutTo;
    }
    for (const gap of run.gaps) {
      const { x, z } = pointOn(run, gap.center);
      if (outdoor) {
        // A dirt path through the hedge, or a glowing one at an exit.
        const path = block(root, run.axis === "x" ? GAP : thick + 1.4, 0.02, run.axis === "x" ? thick + 1.4 : GAP, gap.kind === "exit" ? mat(0x48c487, { emissive: 0x48c487, emissiveIntensity: 0.6 }) : m.trim, x, 0, z);
        path.castShadow = false;
        continue;
      }
      if (!cutaway) {
        // The wall above the opening, and a frame.
        block(root, run.axis === "x" ? GAP : T, wallHeight - DOOR_HEIGHT, run.axis === "x" ? T : GAP, wallMat, x, DOOR_HEIGHT, z);
        for (const side of [-1, 1]) {
          const post = pointOn(run, gap.center + side * (GAP / 2));
          block(root, run.axis === "x" ? 0.07 : T + 0.06, DOOR_HEIGHT, run.axis === "x" ? T + 0.06 : 0.07, m.trim, post.x, 0, post.z);
        }
      }
      if (gap.kind === "door") {
        // An open door, swung against the wall.
        const leafHeight = cutaway ? wallHeight : DOOR_HEIGHT;
        const hinge = pointOn(run, gap.center - GAP / 2 + 0.04, T / 2 + 0.03);
        const leaf = block(root, run.axis === "x" ? 0.05 : GAP - 0.1, leafHeight, run.axis === "x" ? GAP - 0.1 : 0.05, m.wood, 0, 0, 0);
        leaf.position.set(hinge.x + (run.axis === "x" ? 0 : (GAP - 0.1) / 2), leafHeight / 2, hinge.z + (run.axis === "x" ? (GAP - 0.1) / 2 : 0));
      }
      const sill = block(root, run.axis === "x" ? GAP : T + 0.04, 0.02, run.axis === "x" ? T + 0.04 : GAP, gap.kind === "exit" ? mat(0x48c487, { emissive: 0x48c487, emissiveIntensity: 0.6 }) : m.trim, x, 0, z);
      sill.castShadow = false;
    }
  }

  // Keep doorways clear of furniture.
  const clear = [];
  for (const run of runs) {
    for (const gap of run.gaps) {
      const a = pointOn(run, gap.center - GAP / 2 - 0.35, -1.6);
      const b = pointOn(run, gap.center + GAP / 2 + 0.35, 1.6);
      clear.push({ x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) });
    }
  }

  // Furniture and things, room by room.
  const objects = new Map();
  const free = new Map(); // free floor spots per zone, for characters
  for (const [id, zone] of zones) {
    const here = room.objects.filter((object) => object.zone === id && catalog[object.kind]);
    const placed = arrange({ root, zone, here, catalog, m, random, clear, objects, blockers, obstacles, targetId: room.targetId });
    free.set(id, freeSpots(zone, placed, clear));
  }

  // Lights: night sky, moonlight for shadows, one ceiling light per indoor room, and the lamps.
  root.add(new THREE.HemisphereLight(0x8ea6ff, 0x20160f, layout.style === "haunted" ? 0.35 : outdoor ? 1.1 : 0.6));
  const moon = new THREE.DirectionalLight(0x9bb8ff, outdoor ? 2.2 : 1.1);
  const reach = Math.max(X(right) - X(left), Z(bottom) - Z(top)) / 2 + 2;
  moon.position.set(-reach, 18, -reach * 0.6);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.normalBias = 0.03;
  Object.assign(moon.shadow.camera, { left: -reach * 1.4, right: reach * 1.4, top: reach * 1.4, bottom: -reach * 1.4, near: 1, far: 60 });
  root.add(moon, moon.target);
  const ceiling = new Map();
  for (const [id, zone] of outdoor ? [] : zones) {
    const light = new THREE.PointLight(palette.light, 1, 0, 2);
    light.power = 520 * ((zone.x1 - zone.x0) * (zone.z1 - zone.z0)) / (cell * cell);
    light.position.set(zone.cx, cutaway ? 2.4 : wallHeight - 0.2, zone.cz);
    root.add(light);
    ceiling.set(id, light);
  }
  const lamps = new Map();
  for (const object of room.objects) {
    if (object.kind !== "lamp" || !objects.has(object.id)) continue;
    const spot = objects.get(object.id);
    const light = new THREE.PointLight(0xffbf73, 1, 0, 2);
    light.power = 260;
    light.position.set(spot.x, 1.4, spot.z);
    root.add(light);
    lamps.set(object.id, light);
  }

  /** Shows which rooms are lit, from the game's light sources. */
  function setLights(lit, lampsOn) {
    for (const [id, light] of ceiling) light.visible = lit(id);
    for (const [id, light] of lamps) light.visible = lampsOn(id);
  }

  // Exits, the target and the room names.
  for (const exit of exits) {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(GAP, 1.2), new THREE.MeshBasicMaterial({ color: 0x48c487, transparent: true, opacity: 0.4, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    if (exit.axis === "z") glow.rotation.z = Math.PI / 2;
    glow.position.set(exit.outside.x, 0.02, exit.outside.z);
    root.add(glow);
    exit.glow = glow;
    if (labels) {
      const tag = label("EXIT", { color: "#48c487", size: 0.9 });
      tag.position.set(exit.outside.x, wallHeight + 0.5, exit.outside.z);
      root.add(tag);
    }
  }
  const targetSpot = objects.get(room.targetId);
  let targetRing = null;
  if (targetSpot) {
    targetRing = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.025, 8, 48), new THREE.MeshBasicMaterial({ color: 0xf5b942 }));
    targetRing.rotation.x = Math.PI / 2;
    targetRing.position.set(targetSpot.x, targetSpot.y + 0.45, targetSpot.z);
    root.add(targetRing);
  }
  if (labels) {
    // Over the back wall of each room, so they don't cover the characters in the middle.
    for (const zone of zones.values()) {
      const tag = label(zone.name.replace(/^the /, ""), { size: 1.1 });
      tag.position.set(zone.cx, wallHeight + 0.8, zone.z0 + 0.4);
      root.add(tag);
    }
  }

  const missing = room.objects.filter((object) => object.zone && catalog[object.kind] && !objects.has(object.id)).map((object) => object.name);

  return {
    root,
    zones,
    doors,
    exits,
    objects,
    missing, // things that did not fit in the 3D room

    blockers,
    obstacles,
    walls,
    targetRing,
    setLights,
    bounds: { x0: X(left), x1: X(right), z0: Z(top), z1: Z(bottom) },
    /** A free floor spot in a zone, for placing characters. */
    spot(zone, index = 0) {
      const spots = free.get(zone) ?? [];
      const z = zones.get(zone);
      return spots[index % Math.max(spots.length, 1)] ?? { x: z.cx, z: z.cz };
    },
    doorBetween(a, b) {
      return doors.find((door) => (door.from === a && door.to === b) || (door.from === b && door.to === a));
    },
  };
}

// ---------------------------------------------------------------------------
// Placing furniture inside a room

const overlaps = (a, b, margin = 0) => a.x0 < b.x1 + margin && a.x1 > b.x0 - margin && a.z0 < b.z1 + margin && a.z1 > b.z0 - margin;

function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Spots against each wall, in the corners and in the middle, with the way the thing should face. */
function candidates(zone, item, random) {
  const [w, d] = item.size;
  const inset = zone.inset ?? T / 2 + 0.06; // how far things stay from the wall line
  const spots = { wall: [], corner: [], middle: [] };
  const along = (from, to, step) => {
    const list = [];
    for (let v = from; v <= to + 1e-6; v += step) list.push(v);
    return list;
  };
  // Against a wall: north faces +z (turn 0), south faces −z (π), west faces +x (π/2), east faces −x (−π/2).
  for (const x of along(zone.x0 + w / 2 + 0.25, zone.x1 - w / 2 - 0.25, 0.5)) {
    spots.wall.push({ x, z: zone.z0 + inset + d / 2, turn: 0 }, { x, z: zone.z1 - inset - d / 2, turn: Math.PI });
  }
  for (const z of along(zone.z0 + w / 2 + 0.25, zone.z1 - w / 2 - 0.25, 0.5)) {
    spots.wall.push({ x: zone.x0 + inset + d / 2, z, turn: Math.PI / 2 }, { x: zone.x1 - inset - d / 2, z, turn: -Math.PI / 2 });
  }
  spots.corner.push(
    { x: zone.x0 + inset + w / 2, z: zone.z0 + inset + d / 2, turn: 0 },
    { x: zone.x1 - inset - w / 2, z: zone.z0 + inset + d / 2, turn: 0 },
    { x: zone.x0 + inset + w / 2, z: zone.z1 - inset - d / 2, turn: Math.PI },
    { x: zone.x1 - inset - w / 2, z: zone.z1 - inset - d / 2, turn: Math.PI },
  );
  for (const x of along(zone.x0 + 1.4, zone.x1 - 1.4, 1.1)) {
    for (const z of along(zone.z0 + 1.4, zone.z1 - 1.4, 1.1)) spots.middle.push({ x, z, turn: random() > 0.5 ? 0 : Math.PI / 2 });
  }
  return { wall: shuffle(spots.wall, random), corner: shuffle(spots.corner, random), middle: shuffle(spots.middle, random) };
}

function footprint(spot, [w, d]) {
  const turned = Math.abs(Math.sin(spot.turn)) > 0.5;
  const hw = (turned ? d : w) / 2;
  const hd = (turned ? w : d) / 2;
  return { x0: spot.x - hw, x1: spot.x + hw, z0: spot.z - hd, z1: spot.z + hd };
}

function arrange({ root, zone, here, catalog, m, random, clear, objects, blockers, obstacles, targetId }) {
  const placed = []; // { rect, object, item, top, x, z, turn, used, rug, small }
  const margin = zone.inset ?? 0.08;
  const inside = (rect) => rect.x0 >= zone.x0 + margin && rect.x1 <= zone.x1 - margin && rect.z0 >= zone.z0 + margin && rect.z1 <= zone.z1 - margin;
  // Rugs lie under everything; everything else keeps a walkway between pieces.
  const fits = (rect, rug, walkway = 0.4) =>
    inside(rect) && !clear.some((spot) => overlaps(rect, spot)) && !placed.some((other) => !rug && !other.rug && overlaps(rect, other.rect, other.small ? 0.1 : walkway));

  const make = (object, item) => {
    const group = new THREE.Group();
    let top;
    if (object.parts?.length) {
      drawParts(group, object.parts);
      top = SURFACES.includes(object.kind) || SHOWCASES.includes(object.kind) ? item.size[2] : null;
    } else {
      top = (MAKERS[object.kind] ?? ((g, [w, d, h]) => block(g, w, h, d, m.wood) && h))(group, item.size, m, random);
    }
    group.userData.object = object.id;
    root.add(group);
    return { group, top: typeof top === "number" ? top : null };
  };

  // Floor furniture, biggest first.
  const furniture = here.filter((object) => !catalog[object.kind].portable && !WALL_MOUNTED.has(object.kind));
  furniture.sort((a, b) => catalog[b.kind].size[0] * catalog[b.kind].size[1] - catalog[a.kind].size[0] * catalog[a.kind].size[1]);
  for (const object of furniture) {
    const item = catalog[object.kind];
    const rug = object.kind === "rug";
    const base = item.base ?? item.size; // a tree takes the floor space of its trunk; its crown hangs above
    const options = candidates(zone, { ...item, size: base }, random);
    const order = [...(options[item.place] ?? []), ...options.wall, ...options.middle, ...options.corner];
    // First with a walkway around it; if the room is tight, try again closer together.
    const spot = order.find((candidate) => fits(footprint(candidate, base), rug)) ?? order.find((candidate) => fits(footprint(candidate, base), rug, 0.1));
    if (!spot) continue; // no room left; the page lists it, and the game still knows the object is here
    const { group, top } = make(object, item);
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = spot.turn;
    const rect = footprint(spot, base);
    placed.push({ rect, object, item, top, x: spot.x, z: spot.z, turn: spot.turn, used: 0, rug });
    objects.set(object.id, { group, x: spot.x, z: spot.z, y: 0, zone: object.zone });
    if (!rug) obstacles.push([rect.x0, rect.z0, rect.x1, rect.z1]);
    if (item.tall) group.traverse((part) => part.isMesh && blockers.push(part));
  }

  // Wall-mounted things: paintings, switches and power boxes.
  const hung = [];
  for (const object of here.filter((object) => WALL_MOUNTED.has(object.kind))) {
    const item = catalog[object.kind];
    const options = candidates(zone, { size: [item.size[0], 0.02] }, random).wall;
    const spot = options.find((candidate) => {
      const rect = footprint(candidate, [item.size[0] + 0.3, 0.3]);
      return !hung.some((other) => overlaps(rect, other)) && !clear.some((other) => overlaps(rect, other)) && !placed.some((other) => !other.rug && other.item.size[2] > 1.0 && overlaps(rect, other.rect));
    });
    if (!spot) continue;
    hung.push(footprint(spot, [item.size[0] + 0.3, 0.3]));
    const { group } = make(object, item);
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = spot.turn;
    objects.set(object.id, { group, x: spot.x, z: spot.z, y: 1.2, zone: object.zone });
  }

  // Small things go on a surface in the room, or on the floor.
  const small = here.filter((object) => catalog[object.kind].portable && !WALL_MOUNTED.has(object.kind));
  for (const object of small) {
    const item = catalog[object.kind];
    const ranking = object.id === targetId ? SHOWCASES : SURFACES;
    const surface = placed
      .filter((spot) => spot.top !== null && ranking.includes(spot.object.kind) && spot.used < 3)
      .sort((a, b) => ranking.indexOf(a.object.kind) - ranking.indexOf(b.object.kind) || a.used - b.used)[0];
    const { group } = make(object, item);
    let x;
    let z;
    let y = 0;
    if (surface) {
      const reach = Math.min(surface.item.size[0], surface.item.size[1]) * 0.22;
      x = surface.x + (surface.used === 0 ? 0 : (random() - 0.5) * 2 * reach);
      z = surface.z + (surface.used === 0 ? 0 : (random() - 0.5) * 2 * reach);
      y = surface.top;
      surface.used += 1;
    } else {
      const options = candidates(zone, { size: [0.5, 0.5] }, random).middle;
      const spot = options.find((candidate) => fits(footprint(candidate, [0.5, 0.5]), false)) ?? { x: zone.cx, z: zone.cz };
      x = spot.x;
      z = spot.z;
      placed.push({ rect: footprint({ ...spot, turn: 0 }, [0.5, 0.5]), object, item, top: null, x, z, turn: 0, used: 0, small: true });
    }
    group.position.set(x, y, z);
    group.rotation.y = random() * Math.PI * 2;
    objects.set(object.id, { group, x, z, y, zone: object.zone });
  }
  return placed;
}

/** Floor spots with nothing on them, for characters to stand on. */
function freeSpots(zone, placed, clear) {
  const spots = [];
  for (let x = zone.x0 + 0.9; x <= zone.x1 - 0.9; x += 0.7) {
    for (let z = zone.z0 + 0.9; z <= zone.z1 - 0.9; z += 0.7) {
      const rect = { x0: x - 0.35, x1: x + 0.35, z0: z - 0.35, z1: z + 0.35 };
      if (!placed.some((spot) => !spot.rug && overlaps(rect, spot.rect, 0.1)) && !clear.some((spot) => overlaps(rect, spot))) spots.push({ x, z });
    }
  }
  // Nearest to the middle first.
  return spots.sort((a, b) => Math.hypot(a.x - zone.cx, a.z - zone.cz) - Math.hypot(b.x - zone.cx, b.z - zone.cz));
}
