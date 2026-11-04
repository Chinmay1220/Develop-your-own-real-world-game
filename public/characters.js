// Animated characters for any look the designer picks.
// - Real people: realistic men, women and children from Microsoft Rocketbox (MIT), converted by
//   npm run people into public/models/people/. Each is a small body; the animations (idle, walk, run…)
//   are shared by everyone of the same gender, and fitted to each person's height.
// - Stylised people: two rigged models from the three.js examples (Soldier and X Bot, with Mixamo
//   animations), dressed differently for each look.
// - Creatures are built in creatures.js.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { CREATURES, makeCreature } from "./creatures.js";

const SOURCE = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/";
const PEOPLE = new URL("./models/people/", import.meta.url).href;
const ROOT_BONE = "Bip01"; // the hips: the only bone whose position the animations move

const joint = (material) => material.name.toLowerCase().includes("joint");

const LOOKS = {
  thief: {
    model: "bot",
    restyle(material) {
      material.color.set(joint(material) ? 0x2a2d35 : 0x1a1d23);
      if (joint(material)) material.emissive.set(0xf5b942), (material.emissiveIntensity = 0.8);
    },
  },
  kid: {
    model: "bot",
    scale: 0.72,
    restyle(material) {
      material.color.set(joint(material) ? 0x3e6db8 : 0xf2c14e);
    },
  },
  robot: {
    model: "bot",
    restyle(material) {
      material.color.set(joint(material) ? 0x2a3440 : 0xc0c8d0);
      material.metalness = 0.85;
      material.roughness = 0.3;
      if (joint(material)) material.emissive.set(0x4fc3ff), (material.emissiveIntensity = 1.2);
    },
  },
  ghost: {
    model: "bot",
    restyle(material) {
      material.color.set(0xdde8ff);
      material.emissive.set(0x88aaff);
      material.emissiveIntensity = 0.7;
      material.transparent = true;
      material.opacity = 0.55;
      material.depthWrite = false;
    },
  },
  guard: {
    model: "soldier",
    restyle(material) {
      material.color.set(0x8fa6dc); // tints the uniform blue
    },
  },
  soldier: { model: "soldier" },
};

let models = null;
let people = null; // public/models/people/index.json, or null if the people aren't installed
const bodies = {}; // person → their loaded GLB, shared by every copy
const motions = {}; // gender → the shared animation clips

/** Loads both stylised models and the list of real people once. The X Bot's sneak pose becomes an extra layer on top of walking. */
export async function loadCharacters() {
  if (models) return models;
  const loader = new GLTFLoader();
  const [soldier, bot, list] = await Promise.all([
    loader.loadAsync(`${SOURCE}Soldier.glb`),
    loader.loadAsync(`${SOURCE}Xbot.glb`),
    fetch(`${PEOPLE}index.json`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null),
  ]);
  people = list;
  const sneakSource = bot.animations.find((clip) => clip.name === "sneak_pose");
  THREE.AnimationUtils.makeClipAdditive(sneakSource);
  models = { soldier, bot, sneak: THREE.AnimationUtils.subclip(sneakSource, "sneak", 2, 3, 30) };
  return models;
}

/** The real people that can be used as looks: { Police_Male_01: { description, height, … }, … }. */
export const realPeople = () => people?.people ?? {};

/** An animation fitted to a person whose hips are `ratio` times as high as the skeleton it was made on. */
function fitted(clip, ratio) {
  const copy = clip.clone();
  for (const track of copy.tracks) if (track.name === `${ROOT_BONE}.position`) for (let i = 0; i < track.values.length; i++) track.values[i] *= ratio;
  return copy;
}

/** A real person. It shows (and animates) as soon as its body has loaded; until then play() is remembered. */
function makePerson(id, info) {
  const loader = new GLTFLoader();
  const motion = people.animations[info.gender];
  bodies[id] ??= loader.loadAsync(`${PEOPLE}${info.file}`);
  motions[info.gender] ??= loader.loadAsync(`${PEOPLE}${motion.file}`).then((gltf) => gltf.animations);
  const root = new THREE.Group();
  const person = { root, mixer: null, actions: {}, current: null, look: id, height: info.height, speeds: { walk: motion.speeds.walk, run: motion.speeds.run }, wanted: ["idle", 1] };
  person.ready = Promise.all([bodies[id], motions[info.gender]])
    .then(([gltf, clips]) => {
      const body = SkeletonUtils.clone(gltf.scene);
      body.traverse((part) => {
        if (!part.isMesh) return;
        part.castShadow = true;
        part.frustumCulled = false; // animated meshes move outside their resting bounds
      });
      root.add(body);
      person.mixer = new THREE.AnimationMixer(body);
      for (const clip of clips) person.actions[clip.name] = person.mixer.clipAction(fitted(clip, info.rootHeight / motion.rootHeight));
      play(person, ...person.wanted);
    })
    .catch((error) => console.warn(`kit.character: "${id}" didn't load: ${error.message}`));
  return person;
}

/** A character with idle, walk and run animations that blend into each other. Creatures are built in creatures.js. */
export function makeCharacter(look, color) {
  if (CREATURES.has(look)) return makeCreature(look, color);
  const real = people?.people?.[look];
  if (real) return makePerson(look, real);
  const style = LOOKS[look] ?? LOOKS.guard;
  const gltf = models[style.model];
  const root = new THREE.Group();
  const model = SkeletonUtils.clone(gltf.scene);
  model.rotation.y = style.model === "soldier" ? Math.PI : 0; // the two models face different ways; this makes both face +z
  model.scale.setScalar(style.scale ?? 1);
  model.traverse((part) => {
    if (!part.isMesh) return;
    part.castShadow = true;
    part.frustumCulled = false; // animated meshes move outside their resting bounds
    if (style.restyle) {
      part.material = part.material.clone();
      style.restyle(part.material);
    }
  });
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name.toLowerCase(), mixer.clipAction(clip)]));
  const person = { root, mixer, actions, current: null, look, height: 1.8 * (style.scale ?? 1) };
  if (style.model === "bot") {
    person.sneak = mixer.clipAction(models.sneak);
    person.sneak.setEffectiveWeight(0).play();
  }
  play(person, "idle");
  return person;
}

export function play(person, name, timeScale = 1) {
  if (person.creature) {
    person.mode = name; // creatures animate their legs in code
    return;
  }
  if (person.wanted && !person.mixer) {
    person.wanted = [name, timeScale]; // a real person still loading
    return;
  }
  const next = person.actions[name];
  if (!next) return;
  next.timeScale = timeScale;
  if (person.current === next) return;
  next.reset().setEffectiveWeight(1).fadeIn(0.25).play();
  person.current?.fadeOut(0.25);
  person.current = next;
}
