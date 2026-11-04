// A detailed Formula 1 car built in code, to real measurements: 5.6 m long, 2 m wide, a 3.6 m
// wheelbase and 18-inch wheels. Sculpted body, multi-element wings, halo, sidepods, airbox and fin,
// suspension, tyres with coloured sidewall bands, clear-coat paint and carbon fibre.
// It faces +z with its middle on the ground at the origin.
import * as THREE from "three";

const TYRE_COLOURS = { soft: 0xe10600, medium: 0xffd12e, hard: 0xf2f2f2 };

/** Smoothly fills in extra cross-sections between the given ones (Catmull-Rom), so lofts look round. */
function resample(sections, per = 5) {
  const out = [];
  const keys = Object.keys(sections[0]);
  const get = (i) => sections[Math.max(0, Math.min(sections.length - 1, i))];
  for (let i = 0; i < sections.length - 1; i++) {
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      const point = {};
      for (const key of keys) {
        const [a, b, c, d] = [p0[key], p1[key], p2[key], p3[key]];
        point[key] = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      }
      out.push(point);
    }
  }
  out.push({ ...sections.at(-1) });
  return out;
}

/**
 * A smooth body through cross-sections ordered front to back. Each section is a rounded rectangle
 * (a superellipse) at depth z, with width w, height h and centre height y, shifted sideways by x.
 */
function loft(sections, { around = 32, power = 3.2 } = {}) {
  const rings = resample(sections);
  const positions = [];
  const indices = [];
  for (const ring of rings) {
    for (let i = 0; i < around; i++) {
      const t = (i / around) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      positions.push((ring.x ?? 0) + Math.sign(c) * Math.abs(c) ** (2 / power) * (ring.w / 2), ring.y + Math.sign(s) * Math.abs(s) ** (2 / power) * (ring.h / 2), ring.z);
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < around; i++) {
      const a = k * around + i;
      const b = k * around + ((i + 1) % around);
      const c = (k + 1) * around + i;
      const d = (k + 1) * around + ((i + 1) % around);
      indices.push(a, c, b, b, c, d);
    }
  }
  // Close both ends.
  for (const [ring, flip] of [[0, false], [rings.length - 1, true]]) {
    const centre = positions.length / 3;
    const r = rings[ring];
    positions.push(r.x ?? 0, r.y, r.z);
    for (let i = 0; i < around; i++) {
      const a = ring * around + i;
      const b = ring * around + ((i + 1) % around);
      indices.push(...(flip ? [centre, a, b] : [centre, b, a]));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A wing element: a cambered airfoil of chord c and thickness t, spanning `span` along x. */
function airfoil(chord, thickness, span) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(chord * 0.15, thickness * 1.1, chord * 0.55, thickness * 0.9, chord, thickness * 0.15);
  shape.lineTo(chord, 0);
  shape.bezierCurveTo(chord * 0.6, -thickness * 0.15, chord * 0.2, -thickness * 0.35, 0, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 10 });
  geometry.rotateY(Math.PI / 2); // span along x, chord along -z
  geometry.translate(-span / 2, 0, 0);
  return geometry;
}

function canvasTexture(size, draw) {
  const surface = document.createElement("canvas");
  surface.width = surface.height = size;
  draw(surface.getContext("2d"), size);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

let shared = null;
function sharedMaterials() {
  if (shared) return shared;
  // A twill carbon-fibre weave.
  const weave = canvasTexture(64, (g, size) => {
    g.fillStyle = "#0b0b0c";
    g.fillRect(0, 0, size, size);
    const cell = size / 8;
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        g.fillStyle = (x + y) % 4 < 2 ? "#18191b" : "#070708";
        g.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  });
  weave.repeat.set(10, 10);
  shared = {
    carbon: new THREE.MeshPhysicalMaterial({ map: weave, roughness: 0.5, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.88 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.3, metalness: 0.85 }),
    titanium: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.35, metalness: 0.7 }),
    hole: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, roughness: 0.04, metalness: 0.6, clearcoat: 1 }),
  };
  return shared;
}

function numberDecal(number, color) {
  const texture = canvasTexture(256, (g, size) => {
    g.clearRect(0, 0, size, size);
    g.font = "900 170px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 14;
    g.strokeStyle = "#0b0b0b";
    g.strokeText(String(number), size / 2, size / 2 + 8);
    g.fillStyle = color;
    g.fillText(String(number), size / 2, size / 2 + 8);
  });
  return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

/**
 * Builds the car. Returns { root, wheels, steer(angle), roll(distance) }: steer turns the front
 * wheels (radians), roll spins all four by the distance travelled (metres).
 */
export function buildF1Car({ color = "#d1121b", accent = "#f2f2f2", number = 16, tyre = "soft", helmet = "#f5c800" } = {}) {
  const m = sharedMaterials();
  // Real car paint is colour under a clear coat, not metal.
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04 });
  const trim = new THREE.MeshPhysicalMaterial({ color: accent, roughness: 0.4, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06 });
  const root = new THREE.Group();
  const add = (geometry, material, at = [0, 0, 0], rotate = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...at);
    mesh.rotation.set(...rotate);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  /** A thin rod between two points, for suspension arms and wing pillars. */
  const rod = (from, to, radius, material = m.carbon) => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const mesh = add(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 8), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return mesh;
  };

  // Floor: a flat carbon plate, wide at the sidepods and narrow at the front.
  const floor = new THREE.Shape();
  floor.moveTo(-0.32, 1.25);
  floor.lineTo(0.32, 1.25);
  floor.lineTo(0.78, 0.55);
  floor.lineTo(0.8, -1.55);
  floor.lineTo(0.55, -2.15);
  floor.lineTo(-0.55, -2.15);
  floor.lineTo(-0.8, -1.55);
  floor.lineTo(-0.78, 0.55);
  floor.closePath();
  const floorGeometry = new THREE.ExtrudeGeometry(floor, { depth: 0.035, bevelEnabled: false });
  floorGeometry.rotateX(Math.PI / 2);
  add(floorGeometry, m.carbon, [0, 0.085, 0]);

  // Nose, cockpit and engine cover as one smooth body.
  add(
    loft([
      { z: 2.78, w: 0.13, h: 0.09, y: 0.2 },
      { z: 2.35, w: 0.22, h: 0.15, y: 0.25 },
      { z: 1.75, w: 0.34, h: 0.26, y: 0.33 },
      { z: 1.1, w: 0.5, h: 0.4, y: 0.42 },
      { z: 0.55, w: 0.64, h: 0.5, y: 0.46 },
      { z: 0.0, w: 0.74, h: 0.52, y: 0.45 },
      { z: -0.45, w: 0.66, h: 0.82, y: 0.6 },
      { z: -1.1, w: 0.46, h: 0.62, y: 0.52 },
      { z: -1.8, w: 0.3, h: 0.36, y: 0.4 },
      { z: -2.3, w: 0.18, h: 0.2, y: 0.33 },
    ]),
    paint,
  );
  // Sidepods: flat-topped and blended into the body, with dark inlets at the front.
  for (const side of [-1, 1]) {
    add(
      loft(
        [
          { z: 0.45, w: 0.36, h: 0.28, y: 0.36, x: side * 0.5 },
          { z: 0.15, w: 0.5, h: 0.32, y: 0.35, x: side * 0.52 },
          { z: -0.55, w: 0.48, h: 0.28, y: 0.32, x: side * 0.48 },
          { z: -1.3, w: 0.3, h: 0.17, y: 0.24, x: side * 0.38 },
          { z: -1.85, w: 0.14, h: 0.1, y: 0.2, x: side * 0.26 },
        ],
        { power: 5 },
      ),
      paint,
    );
    add(new THREE.PlaneGeometry(0.3, 0.2), m.hole, [side * 0.5, 0.37, 0.455]);
    // Mirrors on stalks.
    rod([side * 0.36, 0.6, 0.55], [side * 0.5, 0.68, 0.6], 0.012, m.carbon);
    add(new THREE.BoxGeometry(0.14, 0.06, 0.05), paint, [side * 0.53, 0.69, 0.6]);
  }
  // Cockpit opening, airbox intake, roll hoop and shark fin.
  add(new THREE.CircleGeometry(0.22, 24), m.hole, [0, 0.715, 0.05], [-Math.PI / 2 + 0.08, 0, 0]).scale.set(1, 1.5, 1);
  add(new THREE.CircleGeometry(0.11, 20), m.hole, [0, 0.95, -0.27], [-0.15, 0, 0]).scale.set(1.2, 1, 1);
  // A low shark fin along the engine cover, in body colour.
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(1.3, 0);
  fin.lineTo(1.3, 0.12);
  fin.quadraticCurveTo(0.4, 0.17, 0, 0.04);
  fin.closePath();
  const finGeometry = new THREE.ExtrudeGeometry(fin, { depth: 0.016, bevelEnabled: false });
  finGeometry.rotateY(Math.PI / 2);
  add(finGeometry, paint, [-0.008, 0.82, -0.75]);

  // Halo: a titanium hoop round the driver, with a centre pillar.
  const haloCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.33, 0.7, -0.2),
    new THREE.Vector3(-0.3, 0.84, 0.15),
    new THREE.Vector3(0, 0.9, 0.42),
    new THREE.Vector3(0.3, 0.84, 0.15),
    new THREE.Vector3(0.33, 0.7, -0.2),
  ]);
  add(new THREE.TubeGeometry(haloCurve, 40, 0.025, 10), m.titanium);
  rod([0, 0.66, 0.62], [0, 0.9, 0.42], 0.022, m.titanium);
  // The driver's helmet and visor.
  add(new THREE.SphereGeometry(0.135, 24, 18), new THREE.MeshPhysicalMaterial({ color: helmet, roughness: 0.2, clearcoat: 1 }), [0, 0.8, -0.02]);
  add(new THREE.SphereGeometry(0.137, 24, 12, Math.PI / 2 - 0.9, 1.8, 1.1, 0.55), m.visor, [0, 0.8, -0.02]); // a strip facing forward (+z)

  // Front wing: four stacked elements between endplates, hung from the nose.
  [
    [0.33, 0.035, 0.07, 2.85, 0.05],
    [0.2, 0.025, 0.12, 2.58, 0.28],
    [0.16, 0.02, 0.16, 2.44, 0.45],
    [0.13, 0.018, 0.2, 2.33, 0.62],
  ].forEach(([chord, thickness, y, z, angle], i) => add(airfoil(chord, thickness, 1.9 - i * 0.04), i % 2 ? trim : m.carbon, [0, y, z], [angle, 0, 0]));
  for (const side of [-1, 1]) {
    const plate = add(new THREE.BoxGeometry(0.018, 0.22, 0.62), m.carbon, [side * 0.955, 0.15, 2.62]);
    plate.rotation.y = side * -0.05;
    rod([side * 0.1, 0.13, 2.62], [side * 0.08, 0.26, 2.5], 0.015);
  }

  // Rear wing: main plane and DRS flap between tall endplates, a beam wing below, on a pylon.
  add(airfoil(0.3, 0.05, 1.0), m.carbon, [0, 0.8, -2.42], [0.18, 0, 0]);
  add(airfoil(0.2, 0.03, 1.0), trim, [0, 0.93, -2.48], [0.55, 0, 0]);
  add(airfoil(0.18, 0.03, 0.9), m.carbon, [0, 0.42, -2.35], [0.25, 0, 0]);
  for (const side of [-1, 1]) {
    const endplate = new THREE.Shape();
    endplate.moveTo(0, 0);
    endplate.lineTo(0.5, 0);
    endplate.lineTo(0.5, 0.62);
    endplate.quadraticCurveTo(0.3, 0.72, 0, 0.66);
    endplate.closePath();
    const geometry = new THREE.ExtrudeGeometry(endplate, { depth: 0.018, bevelEnabled: false });
    geometry.rotateY(Math.PI / 2);
    add(geometry, paint, [side * 0.51 - 0.009, 0.4, -2.18]);
  }
  rod([0, 0.42, -2.05], [0, 0.82, -2.35], 0.03);
  // Diffuser strakes under the back.
  for (const x of [-0.42, -0.21, 0, 0.21, 0.42]) add(new THREE.BoxGeometry(0.012, 0.16, 0.5), m.carbon, [x, 0.13, -2.25], [0.35, 0, 0]);

  // Numbers on the nose and the fin.
  const decal = numberDecal(number, accent === "#f2f2f2" ? "#ffffff" : accent);
  add(new THREE.PlaneGeometry(0.2, 0.2), decal, [0, 0.43, 1.25], [-Math.PI / 2 + 0.28, 0, 0]);
  for (const side of [-1, 1]) add(new THREE.PlaneGeometry(0.16, 0.16), decal, [side * 0.01, 0.89, -1.55], [0, side * Math.PI / 2, 0]);

  // Wheels: tyre (with a coloured compound band), wheel cover and hub; front ones steer.
  const wheels = [];
  const band = new THREE.MeshStandardMaterial({ color: TYRE_COLOURS[tyre] ?? TYRE_COLOURS.soft, roughness: 0.6 });
  for (const [x, z, width, front] of [[-0.78, 1.75, 0.3, true], [0.78, 1.75, 0.3, true], [-0.76, -1.85, 0.4, false], [0.76, -1.85, 0.4, false]]) {
    const steerer = new THREE.Group();
    steerer.position.set(x, 0.36, z);
    const spinner = new THREE.Group();
    steerer.add(spinner);
    const profile = [
      [0.23, -width / 2],
      [0.33, -width / 2],
      [0.352, -width / 2 + 0.018],
      [0.36, -width / 2 + 0.05],
      [0.362, 0],
      [0.36, width / 2 - 0.05],
      [0.352, width / 2 - 0.018],
      [0.33, width / 2],
      [0.23, width / 2],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const tyreGeometry = new THREE.LatheGeometry(profile, 48);
    tyreGeometry.rotateZ(Math.PI / 2); // axle along x
    const tyreMesh = new THREE.Mesh(tyreGeometry, m.rubber);
    tyreMesh.material.side = THREE.DoubleSide;
    spinner.add(tyreMesh);
    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 8, 48), band);
      ring.rotation.y = Math.PI / 2;
      ring.position.x = side * (width / 2 + 0.002);
      spinner.add(ring);
      const cover = new THREE.Mesh(new THREE.CircleGeometry(0.235, 40), m.metal);
      cover.rotation.y = (side * Math.PI) / 2;
      cover.position.x = side * (width / 2 - 0.01);
      spinner.add(cover);
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12), band);
      nut.rotation.z = Math.PI / 2;
      nut.position.x = side * (width / 2 - 0.0);
      spinner.add(nut);
    }
    steerer.traverse((part) => part.isMesh && (part.castShadow = part.receiveShadow = true));
    root.add(steerer);
    wheels.push({ steerer, spinner, front });
    // Wishbones and push rod from the body to the hub.
    const inner = Math.sign(x) * 0.3;
    for (const [y0, y1] of [[0.25, 0.27], [0.45, 0.5]]) {
      rod([inner, y0, z + 0.15], [x * 0.92, y1, z], 0.014);
      rod([inner, y0, z - 0.15], [x * 0.92, y1, z], 0.014);
    }
    rod([inner * 0.8, 0.55, z + (front ? -0.1 : 0.1)], [x * 0.9, 0.28, z], 0.012);
  }

  return {
    root,
    wheels,
    steer(angle) {
      for (const wheel of wheels) if (wheel.front) wheel.steerer.rotation.y = angle;
    },
    roll(distance) {
      for (const wheel of wheels) wheel.spinner.rotation.x += distance / 0.36;
    },
  };
}
