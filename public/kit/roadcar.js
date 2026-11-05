// Everyday road cars built in code to real measurements: a sedan (4.75 m long, 1.84 m wide), a taxi,
// a police car and an SUV. The body is the car's side profile with real wheel arches, rounded off; the
// cabin is glass all round under a body-coloured roof; paint is colour under a clear coat.
// A car faces +z with its middle on the ground at the origin.
import * as THREE from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

// Side profiles as [z, y] points, front (+z) first, in metres. Arches are cut where the wheels are.
const TYPES = {
  sedan: { length: 4.75, width: 1.84, wheelbase: 2.8, front: 1.425, wheel: 0.33, lift: 0, roof: 1.44, cabin: [0.8, 0.05, -0.7, -1.32], belt: 1.01, hood: 0.92, trunk: 1.0 },
  suv: { length: 4.8, width: 1.92, wheelbase: 2.85, front: 1.45, wheel: 0.37, lift: 0.16, roof: 1.78, cabin: [0.95, 0.25, -1.55, -1.95], belt: 1.08, hood: 1.02, trunk: 1.12 },
};
const KINDS = {
  sedan: { base: "sedan", color: "#5b6670" },
  taxi: { base: "sedan", color: "#f2b90c" },
  police: { base: "sedan", color: "#f4f6f8" },
  suv: { base: "suv", color: "#1f2a36" },
};
export const ROAD_CARS = Object.keys(KINDS);

let shared = null;
function sharedMaterials() {
  shared ??= {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, roughness: 0.04, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.7 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9, side: THREE.DoubleSide }),
    rim: new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.25, metalness: 0.95 }),
    hub: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.8 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.08, metalness: 1 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xf1f1ea, roughness: 0.5 }),
    head: new THREE.MeshStandardMaterial({ color: 0xfff6e8, emissive: 0xfff1dc, emissiveIntensity: 2.6, roughness: 0.2 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x7a0a0a, emissive: 0xff1a12, emissiveIntensity: 1.6, roughness: 0.3 }),
  };
  return shared;
}

/** A sign or plate picture drawn on a canvas. */
function signTexture(text, { background, color, width = 256, height = 64 }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  g.fillStyle = background;
  g.fillRect(0, 0, width, height);
  g.fillStyle = color;
  g.font = `900 ${Math.round(height * 0.62)}px Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, width / 2, height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A side profile ([z, y] points) pushed out across the car's width, with rounded edges. */
function sideBody(points, width, round) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const depth = Math.max(0.05, width - 2 * round);
  // The rounded edge starts inside the outline, so the car keeps its real length and height.
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: round, bevelSize: round, bevelOffset: -round, bevelSegments: 7, curveSegments: 20 });
  geometry.rotateY(-Math.PI / 2); // profile along z, width along x
  geometry.translate(depth / 2, 0, 0);
  return toCreasedNormals(geometry, 0.62); // smooth over the rounded edges, sharp where panels meet at an angle
}

/** Points along a wheel arch: a half circle over the wheel at axle z. */
function arch(z, radius, from, to, bottom) {
  const points = [];
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI * (from === "back" ? i / 14 : 1 - i / 14);
    points.push([z - Math.cos(a) * radius, bottom + Math.sin(a) * (radius + 0.02)]);
  }
  return points;
}

/**
 * Builds a road car. Returns { root, wheels, steer(angle), roll(distance), flash(time) }: steer turns the
 * front wheels, roll spins all four by the distance travelled, and flash blinks a police car's lights.
 */
export function buildRoadCar(kind = "sedan", { color } = {}) {
  const look = KINDS[kind] ?? KINDS.sedan;
  const t = TYPES[look.base];
  const m = sharedMaterials();
  const paint = new THREE.MeshPhysicalMaterial({ color: color ?? look.color, roughness: 0.32, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  const root = new THREE.Group();
  const add = (geometry, material, at = [0, 0, 0], parent = root) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (size, material, at) => add(new THREE.BoxGeometry(...size), material, at);

  const L = t.length / 2;
  const up = t.lift;
  const rearAxle = t.front - t.wheelbase;
  const bottom = 0.24 + up;
  const archRadius = t.wheel + 0.07;

  // The lower body: bumpers, bonnet, sides with arches, boot.
  const profile = [
    [L - 0.08, bottom],
    [L, bottom + 0.14],
    [L - 0.01, 0.62 + up],
    [L - 0.16, 0.8 + up],
    [L - 0.7, t.hood + up * 0.4],
    [t.cabin[0], t.belt],
    [t.cabin[3], t.belt + 0.01],
    [-L + 0.42, t.trunk],
    [-L + 0.07, 0.95 + up * 0.6],
    [-L, 0.7 + up * 0.5],
    [-L + 0.01, bottom + 0.15],
    [-L + 0.1, bottom],
    ...arch(rearAxle, archRadius, "back", "front", bottom),
    [rearAxle + archRadius + 0.04, bottom - 0.03],
    [t.front - archRadius - 0.04, bottom - 0.03],
    ...arch(t.front, archRadius, "back", "front", bottom),
  ];
  add(sideBody(profile, t.width, 0.17), paint);

  // The cabin: glass all round, with the roof and the pillars between the windows in body colour.
  const [screenBase, roofFront, roofBack, rearBase] = t.cabin;
  const cabin = [
    [screenBase + 0.04, t.belt - 0.03],
    [roofFront, t.roof - 0.03],
    [roofBack, t.roof],
    [rearBase - 0.02, t.belt - 0.02],
  ];
  const cabinWidth = t.width - 0.3;
  add(sideBody(cabin, cabinWidth, 0.2), m.glass);
  const roof = [
    [roofFront + 0.06, t.roof - 0.09],
    [roofFront - 0.02, t.roof - 0.005],
    [roofBack + 0.02, t.roof + 0.025],
    [roofBack - 0.1, t.roof - 0.06],
  ];
  add(sideBody(roof, cabinWidth - 0.04, 0.16), paint);
  const middle = (roofFront + roofBack) / 2;
  for (const side of [-1, 1]) {
    const pillar = box([0.05, t.roof - t.belt, 0.1], paint, [side * (cabinWidth / 2 + 0.085), (t.roof + t.belt) / 2, middle]);
    pillar.rotation.z = side * 0.12; // the cabin narrows toward the roof
    box([0.05, 0.11, 0.2], paint, [side * (t.width / 2 + 0.06), t.belt + 0.06, screenBase - 0.12]); // mirrors
  }

  // Lights, grille, bumpers and number plates.
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.42, 0.11, 0.08), m.head, [side * (t.width / 2 - 0.3), 0.74 + up * 0.7, L - 0.06]).rotation.y = side * -0.12;
    add(new THREE.BoxGeometry(0.38, 0.12, 0.06), m.tail, [side * (t.width / 2 - 0.27), 0.86 + up * 0.6, -L + 0.03]);
  }
  box([0.86, 0.2, 0.06], m.plastic, [0, 0.55 + up * 0.6, L - 0.01]);
  box([t.width - 0.14, 0.14, 0.1], m.plastic, [0, bottom + 0.1, L - 0.02]);
  box([t.width - 0.14, 0.14, 0.1], m.plastic, [0, bottom + 0.1, -L + 0.03]);
  for (const end of [1, -1]) box([0.5, 0.12, 0.02], m.plate, [0, bottom + 0.26, end * (L + 0.005)]);

  if (kind === "taxi") {
    const sign = new THREE.MeshStandardMaterial({ map: signTexture("TAXI", { background: "#fff7d6", color: "#1a1a1a" }), emissive: 0xffe9a8, emissiveIntensity: 0.9, emissiveMap: null, roughness: 0.4 });
    box([0.62, 0.17, 0.24], sign, [0, t.roof + 0.11, middle + 0.05]);
  }
  let flashers = [];
  if (kind === "police") {
    for (const side of [-1, 1]) {
      box([0.02, 0.09, t.length * 0.62], new THREE.MeshStandardMaterial({ color: 0x1846b8, roughness: 0.4 }), [side * (t.width / 2 + 0.07), 0.74 + up, 0]);
      const word = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.22), new THREE.MeshStandardMaterial({ map: signTexture("POLICE", { background: "#f4f6f8", color: "#1846b8" }), roughness: 0.4 }));
      word.position.set(side * (t.width / 2 + 0.085), 0.9 + up, -0.25);
      word.rotation.y = side * (Math.PI / 2);
      root.add(word);
    }
    box([1.12, 0.1, 0.26], m.plastic, [0, t.roof + 0.06, middle + 0.1]);
    flashers = [
      { colour: 0xff1a1a, x: -0.3 },
      { colour: 0x1a5cff, x: 0.3 },
    ].map(({ colour, x }) => add(new THREE.BoxGeometry(0.46, 0.1, 0.22), new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 3, roughness: 0.3 }), [x, t.roof + 0.14, middle + 0.1]));
  }

  // Wheels: tyres with rounded shoulders, silver five-spoke rims.
  const wheels = [];
  const r = t.wheel;
  const w = 0.23;
  const tyre = new THREE.LatheGeometry(
    [[r * 0.66, -w / 2], [r * 0.93, -w / 2], [r * 0.98, -w / 2 + 0.03], [r, -w / 2 + 0.07], [r, w / 2 - 0.07], [r * 0.98, w / 2 - 0.03], [r * 0.93, w / 2], [r * 0.66, w / 2]].map(([a, b]) => new THREE.Vector2(a, b)),
    40,
  ).rotateZ(Math.PI / 2);
  const rimDisc = new THREE.CylinderGeometry(r * 0.66, r * 0.66, w * 0.7, 32).rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.03, r * 1.15, 0.06);
  for (const [z, front] of [[t.front, true], [rearAxle, false]]) {
    for (const side of [-1, 1]) {
      const steerer = new THREE.Group();
      steerer.position.set(side * (t.width / 2 - w / 2 - 0.03), r, z);
      const spinner = new THREE.Group();
      steerer.add(spinner);
      add(tyre, m.rubber, [0, 0, 0], spinner);
      add(rimDisc, m.hub, [0, 0, 0], spinner);
      for (let i = 0; i < 5; i++) {
        const arm = add(spoke, m.rim, [side * (w * 0.36), 0, 0], spinner);
        arm.rotation.x = (i / 5) * Math.PI * 2;
      }
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16).rotateZ(Math.PI / 2), m.chrome, [side * (w * 0.38), 0, 0], spinner);
      root.add(steerer);
      wheels.push({ steerer, spinner, front });
    }
  }

  return {
    root,
    wheels,
    kind,
    length: t.length,
    width: t.width,
    steer(angle) {
      for (const wheel of wheels) if (wheel.front) wheel.steerer.rotation.y = angle;
    },
    roll(distance) {
      for (const wheel of wheels) wheel.spinner.rotation.x += distance / r;
    },
    /** Blinks a police car's red and blue lights (on = false switches them off); returns which is lit (0 or 1), or -1. */
    flash(time, on = true) {
      if (flashers.length === 0) return -1;
      const lit = on ? Math.floor(time * 4) % 2 : -1;
      flashers.forEach((light, i) => (light.material.emissiveIntensity = i === lit ? 4 : 0.2));
      return lit;
    },
  };
}
