// Creatures with walking legs, built from simple shapes and animated in code: ants, beetles,
// spiders, bees, dogs, cats, mice and birds. They work like the people in characters.js:
// person.mixer.update(dt) moves their legs, and play(person, "walk") changes the gait.
import * as THREE from "three";

const COLORS = { ant: 0x3a1d12, beetle: 0x1f5a3a, bee: 0xf2c14e, spider: 0x2a2a2e, dog: 0x9a6a3e, cat: 0xd98a3e, mouse: 0x9a9aa2, bird: 0x3e6db8 };
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const ROD = new THREE.CylinderGeometry(1, 1, 1, 10);
const UP = new THREE.Vector3(0, 1, 0);

const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...options });

function blob(parent, material, [x, y, z], [sx, sy, sz]) {
  const mesh = new THREE.Mesh(SPHERE, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** A rod from one point to another. */
function limb(parent, material, from, to, radius) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const mesh = new THREE.Mesh(ROD, material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(radius, a.distanceTo(b), radius);
  mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** A jointed leg on a pivot at the hip, so it can swing. Points are relative to the hip. */
function leg(parent, material, hip, knee, foot, radius) {
  const pivot = new THREE.Group();
  pivot.position.set(...hip);
  parent.add(pivot);
  limb(pivot, material, [0, 0, 0], knee, radius);
  limb(pivot, material, knee, foot, radius * 0.8);
  return pivot;
}

const eyes = (parent, [x, y, z], size) => {
  const black = mat(0x0a0a0a, { roughness: 0.15 });
  for (const side of [-1, 1]) blob(parent, black, [side * x, y, z], [size, size, size]);
};

// ---------------------------------------------------------------------------
// Body plans. Each returns the parts that move. All face +z.

function insect(kind, body, dark, c) {
  const bee = kind === "bee";
  const beetle = kind === "beetle";
  const y = 0.36 + (bee ? 0.5 : 0); // bees hover
  blob(c.rig, body, [0, y + 0.02, -0.42], beetle ? [0.34, 0.24, 0.42] : [0.26, 0.22, 0.34]); // abdomen
  if (bee) for (const z of [-0.34, -0.5]) blob(c.rig, dark, [0, y + 0.02, z], [0.265, 0.225, 0.05]); // stripes
  if (!beetle) blob(c.rig, body, [0, y, -0.1], [0.07, 0.07, 0.08]); // waist
  blob(c.rig, body, [0, y + 0.02, 0.04], [0.15, 0.14, 0.19]); // thorax
  blob(c.rig, body, [0, y + 0.08, 0.3], [0.17, 0.16, 0.17]); // head
  eyes(c.rig, [0.11, y + 0.13, 0.37], 0.045);
  if (kind === "ant") for (const side of [-1, 1]) limb(c.rig, dark, [side * 0.05, y + 0.01, 0.42], [side * 0.015, y - 0.04, 0.52], 0.015);
  for (const side of [-1, 1]) {
    const antenna = new THREE.Group();
    antenna.position.set(side * 0.05, y + 0.22, 0.36);
    limb(antenna, dark, [0, 0, 0], [side * 0.08, 0.22, 0.08], 0.012);
    limb(antenna, dark, [side * 0.08, 0.22, 0.08], [side * 0.14, 0.26, 0.3], 0.01);
    antenna.userData.offset = side;
    c.rig.add(antenna);
    c.antennae.push(antenna);
  }
  if (bee) {
    const wing = mat(0xdff2ff, { transparent: true, opacity: 0.45, depthWrite: false });
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.08, y + 0.17, -0.02);
      blob(pivot, wing, [side * 0.2, 0, -0.04], [0.22, 0.01, 0.11]);
      pivot.userData.side = side;
      c.rig.add(pivot);
      c.wings.push(pivot);
    }
  }
  // Six legs in two tripods: front and back on one side move with the middle leg on the other.
  [0.1, 0.03, -0.05].forEach((z, row) => {
    const forward = 1 - row; // front legs reach forward, back legs back
    for (const side of [-1, 1]) {
      const foot = bee ? [side * 0.16, -0.3, forward * 0.08] : [side * 0.44, -y, forward * 0.2];
      const pivot = leg(c.rig, dark, [side * 0.08, y - 0.02, z], [side * 0.24, bee ? -0.06 : 0.16, forward * 0.06], foot, 0.022);
      c.legs.push({ pivot, side, phase: (row % 2 === 0) === side > 0 ? 0 : Math.PI, swing: "y" });
    }
  });
  c.height = y + 0.45;
  c.bob = bee ? 0 : 0.015;
  c.hover = bee;
}

function spider(body, dark, c) {
  const y = 0.34;
  blob(c.rig, body, [0, y, 0.14], [0.17, 0.12, 0.2]);
  blob(c.rig, body, [0, y + 0.08, -0.26], [0.3, 0.26, 0.34]);
  eyes(c.rig, [0.06, y + 0.07, 0.31], 0.035);
  eyes(c.rig, [0.11, y + 0.05, 0.27], 0.025);
  [0.24, 0.17, 0.1, 0.03].forEach((z, row) => {
    const forward = 1.5 - row;
    for (const side of [-1, 1]) {
      const pivot = leg(c.rig, dark, [side * 0.1, y, z], [side * 0.36, 0.3, forward * 0.12], [side * 0.68, -y, forward * 0.3], 0.024);
      c.legs.push({ pivot, side, phase: (row % 2 === 0) === side > 0 ? 0 : Math.PI, swing: "y" });
    }
  });
  c.height = y + 0.6;
  c.bob = 0.01;
}

const ANIMALS = {
  dog: { hip: 0.45, body: [0.22, 0.2, 0.42], head: 0.17, ears: "floppy", tail: 0.32, spread: 0.28 },
  cat: { hip: 0.34, body: [0.16, 0.15, 0.36], head: 0.14, ears: "pointy", tail: 0.45, spread: 0.24 },
  mouse: { hip: 0.14, body: [0.14, 0.12, 0.24], head: 0.1, ears: "round", tail: 0.4, spread: 0.14 },
};

function fourLegs(kind, body, dark, c) {
  const a = ANIMALS[kind];
  const y = a.hip + a.body[1] * 0.6;
  blob(c.rig, body, [0, y, 0], a.body);
  const headY = y + a.body[1] * 0.9;
  const headZ = a.body[2] + a.head * 0.4;
  blob(c.rig, body, [0, headY, headZ], [a.head, a.head * 0.95, a.head]);
  blob(c.rig, kind === "mouse" ? mat(0xe8a0b0) : body, [0, headY - a.head * 0.25, headZ + a.head * 0.85], [a.head * 0.45, a.head * 0.4, a.head * 0.55]); // snout
  blob(c.rig, mat(0x111111), [0, headY - a.head * 0.15, headZ + a.head * 1.35], [a.head * 0.12, a.head * 0.1, a.head * 0.1]); // nose
  eyes(c.rig, [a.head * 0.45, headY + a.head * 0.25, headZ + a.head * 0.75], a.head * 0.13);
  for (const side of [-1, 1]) {
    const at = [side * a.head * 0.6, headY + a.head * 0.75, headZ - a.head * 0.1];
    if (a.ears === "pointy") {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(a.head * 0.3, a.head * 0.6, 4), body);
      ear.position.set(...at);
      c.rig.add(ear);
    } else if (a.ears === "round") {
      blob(c.rig, mat(0xe8a0b0), at, [a.head * 0.45, a.head * 0.45, a.head * 0.08]);
    } else {
      blob(c.rig, dark, [side * a.head * 0.85, headY + a.head * 0.1, headZ - a.head * 0.1], [a.head * 0.18, a.head * 0.55, a.head * 0.35]);
    }
  }
  // Legs trot in diagonal pairs.
  for (const [x, z, phase] of [[-1, 1, 0], [1, -1, 0], [1, 1, Math.PI], [-1, -1, Math.PI]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x * a.body[0] * 0.6, a.hip, z * a.spread);
    limb(pivot, dark, [0, 0.05, 0], [0, -a.hip, 0.02], a.hip * 0.13 + 0.015);
    c.rig.add(pivot);
    c.legs.push({ pivot, side: x, phase, swing: "x" });
  }
  const tail = new THREE.Group();
  tail.position.set(0, y + a.body[1] * 0.3, -a.body[2] * 0.95);
  limb(tail, kind === "mouse" ? mat(0xe8a0b0) : body, [0, 0, 0], kind === "cat" ? [0, a.tail, -a.tail * 0.4] : [0, a.tail * 0.3, -a.tail], kind === "mouse" ? 0.012 : 0.03);
  c.rig.add(tail);
  c.tail = tail;
  c.height = headY + a.head + 0.1;
  c.bob = a.hip * 0.06;
}

function bird(body, dark, c) {
  const y = 0.4;
  blob(c.rig, body, [0, y, 0], [0.16, 0.15, 0.22]);
  blob(c.rig, body, [0, y + 0.2, 0.17], [0.11, 0.11, 0.11]);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 8), mat(0xf2a33a));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, y + 0.18, 0.32);
  c.rig.add(beak);
  eyes(c.rig, [0.07, y + 0.24, 0.24], 0.022);
  blob(c.rig, dark, [0, y + 0.04, -0.27], [0.1, 0.03, 0.14]); // tail
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.14, y + 0.06, 0);
    blob(pivot, dark, [side * 0.04, 0, -0.04], [0.05, 0.1, 0.17]);
    pivot.userData.side = side;
    c.rig.add(pivot);
    c.wings.push(pivot);
    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.06, y - 0.12, 0.02);
    limb(legPivot, mat(0xf2a33a), [0, 0, 0], [0, -(y - 0.12), 0.03], 0.012);
    c.rig.add(legPivot);
    c.legs.push({ pivot: legPivot, side, phase: side > 0 ? 0 : Math.PI, swing: "x" });
  }
  c.height = y + 0.45;
  c.bob = 0.05; // birds hop
  c.flapWhileWalking = true;
}

// ---------------------------------------------------------------------------

export const CREATURES = new Set(Object.keys(COLORS));

/** A creature with the same shape as a character from characters.js. */
export function makeCreature(kind, color) {
  const tone = new THREE.Color(color || COLORS[kind]);
  const body = mat(tone);
  const dark = mat(tone.clone().multiplyScalar(0.55));
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);
  const c = { rig, legs: [], antennae: [], wings: [], tail: null, height: 1, bob: 0, hover: false, time: Math.random() * 10, phase: 0, amount: 0 };
  if (kind === "spider") spider(body, dark, c);
  else if (kind === "bird") bird(body, dark, c);
  else if (ANIMALS[kind]) fourLegs(kind, body, dark, c);
  else insect(kind, body, dark, c);
  const person = { root, creature: c, mode: "idle", height: c.height, look: kind, actions: {}, current: null };
  person.mixer = { update: (dt) => animate(person, dt) };
  return person;
}

function animate(person, dt) {
  const c = person.creature;
  const pace = person.mode === "run" ? 16 : person.mode === "walk" ? 9 : 0;
  c.time += dt;
  c.phase += dt * pace;
  c.amount += ((pace > 0 ? 1 : 0) - c.amount) * Math.min(1, dt * 6); // ease into and out of walking
  for (const leg of c.legs) {
    const swing = Math.sin(c.phase + leg.phase);
    if (leg.swing === "y") {
      leg.pivot.rotation.y = swing * 0.45 * c.amount;
      leg.pivot.rotation.z = Math.max(0, Math.cos(c.phase + leg.phase)) * 0.3 * c.amount * leg.side; // lift the leg as it swings forward
    } else {
      leg.pivot.rotation.x = swing * 0.6 * c.amount;
    }
  }
  c.rig.position.y = Math.abs(Math.sin(c.phase)) * c.bob * c.amount + (c.hover ? Math.sin(c.time * 3) * 0.05 : 0);
  for (const antenna of c.antennae) antenna.rotation.x = Math.sin(c.time * 4 + antenna.userData.offset) * 0.15;
  for (const wing of c.wings) {
    const flap = c.hover ? Math.sin(c.time * 45) * 0.6 : c.flapWhileWalking ? Math.sin(c.time * 18) * 0.5 * c.amount : 0;
    wing.rotation.z = flap * wing.userData.side;
  }
  if (c.tail) c.tail.rotation.y = Math.sin(c.time * (pace ? 10 : 3)) * 0.35;
}
