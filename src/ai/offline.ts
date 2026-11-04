// Offline stand-ins for the Meta models. They follow simple hand-written rules, so the game runs
// without an API key and the tests are repeatable. They are placeholders, not the AI this project is about.
import { EXAMPLE_DESIGN } from "../design/example.ts";
import { THROW_RANGE } from "../game/checker.ts";
import type { Action, ActionKind, Agent, Change, Loudness, Noise, WorldObject, WorldState, Zone } from "../game/types.ts";
import {
  applyChange,
  createState,
  describeAction,
  distance,
  findPath,
  getGuards,
  getThief,
  hiddenCount,
  hidePhrase,
  isLit,
  stepToward,
} from "../game/world.ts";
import type { AiSet, Designer, GuardBrain, GuardMind, Lesson, NewLesson, Reflector, Teacher, WorldMistake, WorldModel } from "./types.ts";

// ---------------------------------------------------------------------------
// Reading typed actions

// Checked in this order, so "crawl under the bed" is a hide and not a move.
const VERBS: [ActionKind, RegExp][] = [
  ["throw", /\b(throw|toss|chuck|fling|lob)\b/],
  ["unhide", /\b(come out|get out|step out|climb out|leave)\b/],
  ["hide", /\b(hide|duck|squeeze|crawl under|get under|get behind|get in)\b/],
  ["use", /\b(turn|switch|unplug|plug|flip)\b/],
  ["take", /\b(take|grab|pick|steal|snatch|get)\b/],
  ["drop", /\b(drop|put down|set down)\b/],
  ["search", /\b(search|check|look in|look under|open)\b/],
  ["move", /\b(go|move|walk|run|sneak|head|step|crawl|creep|tiptoe)\b/],
  ["wait", /\b(wait|stay|listen|hold still|freeze)\b/],
];

const zoneNames = (zone: Zone) => [zone.id, zone.name];
const objectNames = (object: WorldObject) => [object.id, object.name, ...(object.aliases ?? [])];

/** The item whose longest name appears in the text. */
function mentioned<T>(text: string, items: T[], names: (item: T) => string[]): T | undefined {
  let best: T | undefined;
  let bestLength = 0;
  for (const item of items) {
    for (const raw of names(item)) {
      const name = raw.toLowerCase().replace(/^the /, "");
      if (name.length <= bestLength) continue;
      const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (pattern.test(text)) {
        best = item;
        bestLength = name.length;
      }
    }
  }
  return best;
}

/** Turns a typed action into a structured one when the words are clear enough. */
export function interpret(state: WorldState, action: Action): Action {
  if (action.kind !== "free") return action;
  const text = action.text.toLowerCase();
  const actor = state.agents[action.actor];
  const objects = Object.values(state.objects);
  const zone = mentioned(text, Object.values(state.zones), zoneNames);
  const object = mentioned(text, objects, objectNames);
  const held = mentioned(text, objects.filter((o) => o.heldBy === actor.id), objectNames);
  const make = (kind: ActionKind, target?: string, item?: string): Action => ({ ...action, kind, target, item });

  const kind = VERBS.find(([, pattern]) => pattern.test(text))?.[0];
  switch (kind) {
    case "throw": {
      const item = held ?? objects.find((o) => o.heldBy === actor.id);
      const aimedAt = mentioned(text, objects.filter((o) => o.heldBy !== actor.id), objectNames);
      const target = zone?.id ?? aimedAt?.zone ?? undefined;
      return item && target ? make("throw", target, item.id) : action;
    }
    case "unhide":
      if (actor.hiddenIn) return make("unhide");
      return zone ? make("move", zone.id) : action;
    case "hide":
    case "use":
    case "take":
    case "search":
      return object ? make(kind, object.id) : action;
    case "drop": {
      const thing = held ?? object;
      return thing ? make("drop", thing.id) : action;
    }
    case "move":
      return zone ? make("move", zone.id) : action;
    case "wait":
      return make("wait");
    default:
      return action;
  }
}

// ---------------------------------------------------------------------------
// World model stand-in

const SOUNDS: Record<Loudness, string> = { 1: "softly", 2: "with a thud", 3: "with a loud crash" };

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const offlineWorldModel: WorldModel = {
  async resolve(state, actions, worldLessons) {
    const scratch = structuredClone(state);
    const changes: Change[] = [];
    const noises: Noise[] = [];
    const narration: string[] = [];
    const emit = (change: Change) => {
      changes.push(change);
      applyChange(scratch, change);
    };
    for (const raw of actions) {
      const actor = scratch.agents[raw.actor];
      if (!actor) continue;
      const line = resolveOne(state, scratch, actor, interpret(state, raw), worldLessons, emit, noises);
      if (line) narration.push(line);
    }
    return { changes, noises, narration };
  },
};

/** Works out one action and returns its story line. Guards' failed or quiet actions get no line. */
function resolveOne(
  state: WorldState,
  scratch: WorldState,
  actor: Agent,
  action: Action,
  worldLessons: Lesson[],
  emit: (change: Change) => void,
  noises: Noise[],
): string | null {
  const you = actor.role === "thief";
  const object = action.target ? scratch.objects[action.target] : undefined;

  switch (action.kind) {
    case "move": {
      const to = action.target ? state.zones[action.target] : undefined;
      if (!to) return you ? "You're not sure where that is." : null;
      if (to.id === actor.zone) return you ? `You're already at ${to.name}.` : null;
      if (!state.zones[actor.zone].neighbors.includes(to.id)) return you ? `${capitalize(to.name)} is too far to reach in one step.` : null;
      const spot = actor.hiddenIn ? scratch.objects[actor.hiddenIn] : null;
      emit({ op: "move", actor: actor.id, to: to.id });
      if (!you) return `${actor.name} walks to ${to.name}.`;
      return spot ? `You slip out from ${hidePhrase(spot)} and move to ${to.name}.` : `You move to ${to.name}.`;
    }
    case "take": {
      if (!object || object.zone !== actor.zone) return you ? "That isn't within reach." : null;
      if (!object.portable) return you ? `The ${object.name} is too big to carry.` : null;
      if (actor.hiddenIn) return you ? "You can't reach it from your hiding spot." : null;
      emit({ op: "pickUp", actor: actor.id, object: object.id });
      return you ? `You grab the ${object.name}.` : `${actor.name} picks up the ${object.name}.`;
    }
    case "drop": {
      if (!object || object.heldBy !== actor.id) return you ? "You aren't holding that." : null;
      emit({ op: "place", object: object.id, zone: actor.zone });
      return you ? `You set the ${object.name} down.` : `${actor.name} sets the ${object.name} down.`;
    }
    case "hide": {
      if (!object || object.zone !== actor.zone) return you ? "There's nowhere like that to hide right here." : null;
      const forbidden = worldLessons.find((l) => l.kind === "forbid" && l.action === "hide" && l.target === object.id);
      if (forbidden) return you ? `You try to hide ${hidePhrase(object)}, but you can't. ${forbidden.text}` : null;
      if (actor.hiddenIn) return you ? "You're already hiding." : null;
      if (!object.hideCapacity || hiddenCount(scratch, object.id) >= object.hideCapacity) {
        return you ? `There's no room ${hidePhrase(object)}.` : null;
      }
      emit({ op: "hide", actor: actor.id, object: object.id });
      return you ? `You squeeze ${hidePhrase(object)} and keep still.` : `${actor.name} hides ${hidePhrase(object)}.`;
    }
    case "unhide": {
      if (!actor.hiddenIn) return you ? "You aren't hiding." : null;
      const spot = scratch.objects[actor.hiddenIn];
      emit({ op: "unhide", actor: actor.id });
      return you ? `You slip out from ${hidePhrase(spot)}.` : null;
    }
    case "throw": {
      const item = action.item ? scratch.objects[action.item] : undefined;
      const target = action.target ? state.zones[action.target] : undefined;
      if (!item || item.heldBy !== actor.id) return you ? "You don't have that to throw." : null;
      if (!target) return you ? "Throw it where?" : null;
      const path = findPath(state, actor.zone, target.id);
      if (!path) return you ? "You can't throw it there." : null;
      const landing = state.zones[path[Math.min(path.length - 1, THROW_RANGE)]];
      emit({ op: "place", object: item.id, zone: landing.id });
      let loudness: Loudness = item.loudness ?? 2;
      let sound = SOUNDS[loudness];
      if (item.breakable && !item.broken) {
        emit({ op: "set", object: item.id, key: "broken", value: true });
        loudness = 3;
        sound = "and shatters with a loud crash";
      }
      noises.push({ zone: landing.id, loudness, what: `the ${item.name} landing` });
      const short = landing.id === target.id ? "" : " It falls short.";
      return `${you ? "You throw" : `${actor.name} throws`} the ${item.name}.${short} It lands by ${landing.name} ${sound}.`;
    }
    case "use": {
      if (!object || object.zone !== actor.zone) return you ? "That isn't within reach." : null;
      if (!object.switchable) return you ? `Nothing happens when you fiddle with the ${object.name}.` : null;
      const text = action.text.toLowerCase();
      const wanted = /\boff\b|unplug/.test(text) ? false : /\bon\b|plug in/.test(text) ? true : !object.on;
      if (object.on === wanted) return you ? `The ${object.name} is already ${wanted ? "on" : "off"}.` : null;
      emit({ op: "set", object: object.id, key: "on", value: wanted });
      noises.push({ zone: actor.zone, loudness: 1, what: "a soft click" });
      if (!you) return `${actor.name} switches the ${object.name} back ${wanted ? "on" : "off"}.`;
      const darkened = object.lightSource && !wanted ? (object.lights ?? Object.keys(scratch.zones)).filter((zone) => !isLit(scratch, zone)) : [];
      const dark = darkened.includes(actor.zone)
        ? " The room goes dark."
        : darkened.length > 0
          ? ` It goes dark at ${darkened.map((zone) => scratch.zones[zone].name).join(" and ")}.`
          : "";
      return `You switch the ${object.name} ${wanted ? "on" : "off"}.${dark}`;
    }
    case "search": {
      if (!object || object.zone !== actor.zone) return you ? "There's nothing like that here to search." : null;
      return you ? `You check ${hidePhrase(object)}. Nobody's there.` : `${actor.name} checks ${hidePhrase(object)}.`;
    }
    case "wait": {
      if (you) return actor.hiddenIn ? "You stay perfectly still." : "You wait and listen.";
      // "look around the door" becomes "Guard B looks around the door."
      return action.text === "wait" ? null : `${actor.name} ${action.text.replace(/^(\w+)/, "$1s")}.`;
    }
    case "free":
      return you
        ? `Nothing much happens. The offline stand-in only understands simple actions, like "throw the shoe at the closet". The Meta world model will handle anything you type.`
        : null;
  }
}

// ---------------------------------------------------------------------------
// Guard brain stand-in

export const offlineGuardBrain: GuardBrain = {
  async decide({ state, observations, minds, lessons }) {
    const learned = (kind: string) => lessons.some((lesson) => lesson.kind === kind);
    const guards = getGuards(state);
    for (const guard of guards) {
      const mind = minds[guard.id];
      const seen = observations[guard.id];
      mind.note = null;
      if (!seen) continue;
      if (seen.thiefSeenAt) mind.task = { kind: "chase", zone: seen.thiefSeenAt };
      else if (mind.task?.kind === "chase") mind.task = { kind: "investigate", zone: mind.task.zone, looked: false };
      if (seen.sawHideIn) mind.task = { kind: "search", object: seen.sawHideIn };
      // Guards who learned a trick keep the target guarded, and say so in the story.
      const holdsTarget = guard.duty === "target" && guard.post !== undefined && !mind.task;
      const post = guard.post ? state.zones[guard.post].name : "";
      if (!mind.task && seen.heard.length > 0) {
        if (holdsTarget && learned("distraction")) mind.note = `stay at ${post}, because the notebook says noises can be tricks`;
        else mind.task = { kind: "investigate", zone: loudest(seen.heard).zone, looked: false };
      }
      if (holdsTarget && seen.lightsWentOut && learned("darkness")) mind.note = `stay at ${post}, because the notebook says the dark can be a trick`;
    }
    sendSomeoneToTheLight(state, guards, minds, learned("darkness"));
    return guards.map((guard) => nextAction(state, guard, minds[guard.id], lessons));
  },
};

function loudest(noises: Noise[]): Noise {
  return noises.reduce((a, b) => (b.loudness > a.loudness ? b : a));
}

function sendSomeoneToTheLight(state: WorldState, guards: Agent[], minds: Record<string, GuardMind>, learnedDarkness: boolean): void {
  if (guards.some((guard) => minds[guard.id].task?.kind === "relight")) return;
  const lamp = Object.values(state.objects).find((o) => o.lightSource && o.switchable && !o.on && !o.broken && o.zone);
  const lampZone = lamp?.zone;
  if (!lamp || !lampZone) return;
  // Untrained guards send whoever is free. Guards who learned the darkness trick keep the target guard
  // in place and send the other one, even if it was busy.
  const candidates = guards.filter((guard) => {
    const task = minds[guard.id].task;
    if (task?.kind === "chase") return false;
    return learnedDarkness ? guard.duty !== "target" : task === null;
  });
  candidates.sort((a, b) => distance(state, a.zone, lampZone) - distance(state, b.zone, lampZone));
  if (candidates[0]) minds[candidates[0].id].task = { kind: "relight", object: lamp.id };
}

function nextAction(state: WorldState, guard: Agent, mind: GuardMind, lessons: Lesson[]): Action {
  const act = (kind: ActionKind, target?: string, text?: string): Action => ({
    actor: guard.id,
    kind,
    target,
    text: text ?? describeAction(state, { actor: guard.id, kind, target }),
  });
  const goToward = (zone: string) => act("move", stepToward(state, guard.zone, zone));
  const search = (objectId: string) => {
    mind.searched.push(objectId);
    return act("search", objectId);
  };

  const task = mind.task;
  if (task?.kind === "chase" || task?.kind === "investigate") {
    if (guard.zone !== task.zone) return goToward(task.zone);
    if (task.kind === "chase" || !task.looked) {
      mind.task = { kind: "investigate", zone: task.zone, looked: true };
      const spot = learnedSpotHere(state, guard, mind, lessons);
      return spot ? search(spot) : act("wait", undefined, `look around ${state.zones[guard.zone].name}`);
    }
    mind.task = null;
  } else if (task?.kind === "relight") {
    const lamp = state.objects[task.object];
    if (lamp?.zone && !lamp.on) {
      if (guard.zone !== lamp.zone) return goToward(lamp.zone);
      mind.task = null;
      return act("use", lamp.id, `switch the ${lamp.name} on`);
    }
    mind.task = null;
  } else if (task?.kind === "search") {
    const spot = state.objects[task.object];
    if (spot?.zone) {
      if (guard.zone !== spot.zone) return goToward(spot.zone);
      mind.task = null;
      return search(spot.id);
    }
    mind.task = null;
  }

  const spot = learnedSpotHere(state, guard, mind, lessons);
  if (spot) return search(spot);
  if (guard.duty === "patrol" && guard.route && guard.route.length > 1) {
    if (guard.zone === guard.route[mind.leg % guard.route.length]) mind.leg += 1;
    return goToward(guard.route[mind.leg % guard.route.length]);
  }
  if (guard.post && guard.zone !== guard.post) return goToward(guard.post);
  return act("wait", undefined, mind.note ?? undefined);
}

/** A hiding spot from the lessons that is in this guard's zone and not yet searched this round. */
function learnedSpotHere(state: WorldState, guard: Agent, mind: GuardMind, lessons: Lesson[]): string | undefined {
  return lessons.find(
    (lesson) =>
      lesson.kind === "hiding" &&
      lesson.target !== undefined &&
      state.objects[lesson.target]?.zone === guard.zone &&
      !mind.searched.includes(lesson.target),
  )?.target;
}

// ---------------------------------------------------------------------------
// Reflector stand-in: learns from rounds the guards lost by replaying the accepted changes.

export const offlineReflector: Reflector = {
  async reflect({ room, status, steps }) {
    if (status !== "escaped") return [];
    const state = createState(room);
    const thiefId = getThief(state).id;
    const target = state.objects[room.targetId].name;
    const lessons: NewLesson[] = [];
    for (const step of steps) {
      const before = structuredClone(state);
      for (const change of step.accepted) applyChange(state, change);
      for (const change of step.accepted) {
        if (change.op === "place" && before.objects[change.object]?.heldBy === thiefId && change.zone !== before.agents[thiefId].zone) {
          lessons.push({
            kind: "distraction",
            text: `The thief threw the ${before.objects[change.object].name} at ${before.zones[change.zone].name} to pull us away. A noise can be a trick: the guard protecting the ${target} never leaves it to check a noise.`,
          });
        }
        if (change.op === "set" && change.key === "on" && !change.value && before.objects[change.object]?.lightSource) {
          lessons.push({
            kind: "darkness",
            text: `The thief switched off the ${before.objects[change.object].name} and moved in the dark. When the room goes dark, the guard protecting the ${target} stays put and the other guard turns the light back on.`,
          });
        }
        if (change.op === "hide" && change.actor === thiefId) {
          const spot = before.objects[change.object];
          lessons.push({ kind: "hiding", target: spot.id, text: `The thief hid ${hidePhrase(spot)} and we walked past. Search it when passing.` });
        }
      }
    }
    return lessons;
  },
};

// ---------------------------------------------------------------------------
// Teacher stand-in: checks accepted changes against the room's fact list.
// With the API, Muse Wonder does this job by looking at the real place.

export const offlineTeacher: Teacher = {
  async review({ room, steps }) {
    const mistakes: WorldMistake[] = [];
    for (const step of steps) {
      for (const change of step.accepted) {
        if (change.op !== "hide") continue;
        const fact = room.facts.find((f) => f.object === change.object && f.forbids === "hide");
        const object = room.objects.find((o) => o.id === change.object);
        if (!fact || !object) continue;
        mistakes.push({
          step: step.step,
          problem: `The world model let someone hide ${hidePhrase(object)}, but in the real room: ${fact.text}`,
          lesson: { kind: "forbid", action: "hide", target: object.id, text: fact.text },
        });
      }
    }
    return mistakes;
  },
};

// ---------------------------------------------------------------------------
// Designer stand-in: it can't read the player's words, so it always returns the hand-made museum.

export const offlineDesigner: Designer = {
  model: "offline stand-in",
  async design() {
    return {
      ...structuredClone(EXAMPLE_DESIGN),
      note: "The offline stand-in can't read your words, so this is the built-in example level. Add a Meta API key to design a level from your own words.",
    };
  },
  usage: () => null,
};

export function createOfflineAi(): AiSet {
  const name = "offline stand-in";
  return {
    mode: "offline",
    models: { world: name, guards: name, reflector: name, teacher: name },
    world: offlineWorldModel,
    guards: offlineGuardBrain,
    reflector: offlineReflector,
    teacher: offlineTeacher,
    usage: () => null,
    takeWarnings: () => [],
  };
}
