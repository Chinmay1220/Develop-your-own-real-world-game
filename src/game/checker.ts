// The hard rules. Every change the world model proposes passes through here, and impossible ones
// are blocked. The number of blocked changes is one way to measure how often the world model errs.
import type { Action, Change, Noise, Rejection, WorldState } from "./types.ts";
import { applyChange, distance, hiddenCount } from "./world.ts";

export const THROW_RANGE = 3;

export interface CheckResult {
  accepted: Change[];
  rejected: Rejection[];
}

/** Checks changes in order against a scratch copy, so earlier changes count (for example a full hiding spot). */
export function checkChanges(before: WorldState, actions: Action[], changes: Change[]): CheckResult {
  const scratch = structuredClone(before);
  const moved = new Set<string>();
  const accepted: Change[] = [];
  const rejected: Rejection[] = [];
  for (const change of changes) {
    const reason = problemWith(before, scratch, actions, change, moved);
    if (reason) {
      rejected.push({ what: JSON.stringify(change), reason });
      continue;
    }
    applyChange(scratch, change);
    if (change.op === "move") moved.add(change.actor);
    accepted.push(change);
  }
  return { accepted, rejected };
}

export function checkNoises(state: WorldState, noises: Noise[]): { valid: Noise[]; rejected: Rejection[] } {
  const valid: Noise[] = [];
  const rejected: Rejection[] = [];
  for (const noise of noises) {
    if (!state.zones[noise.zone]) rejected.push({ what: JSON.stringify(noise), reason: `a noise in unknown zone "${noise.zone}"` });
    else if (![1, 2, 3].includes(noise.loudness)) rejected.push({ what: JSON.stringify(noise), reason: "noise loudness must be 1, 2 or 3" });
    else valid.push(noise);
  }
  return { valid, rejected };
}

function problemWith(before: WorldState, now: WorldState, actions: Action[], change: Change, moved: Set<string>): string | null {
  switch (change.op) {
    case "move": {
      const agent = now.agents[change.actor];
      if (!agent) return `unknown character "${change.actor}"`;
      const to = now.zones[change.to];
      if (!to) return `unknown zone "${change.to}"`;
      if (moved.has(agent.id)) return `${agent.name} already moved this step`;
      const start = before.zones[before.agents[agent.id].zone];
      if (to.id !== start.id && !start.neighbors.includes(to.id)) return `${agent.name} cannot reach ${to.name} from ${start.name} in one step`;
      return null;
    }
    case "hide": {
      const agent = now.agents[change.actor];
      const object = now.objects[change.object];
      if (!agent) return `unknown character "${change.actor}"`;
      if (!object) return `unknown object "${change.object}"`;
      if (agent.hiddenIn) return `${agent.name} is already hiding`;
      if (object.zone !== agent.zone) return `${agent.name} is not next to the ${object.name}`;
      if (!object.hideCapacity) return `nobody can hide in the ${object.name}`;
      if (hiddenCount(now, object.id) >= object.hideCapacity) return `the ${object.name} is already full`;
      return null;
    }
    case "unhide": {
      const agent = now.agents[change.actor];
      if (!agent) return `unknown character "${change.actor}"`;
      if (!agent.hiddenIn) return `${agent.name} is not hiding`;
      return null;
    }
    case "pickUp": {
      const agent = now.agents[change.actor];
      const object = now.objects[change.object];
      if (!agent) return `unknown character "${change.actor}"`;
      if (!object) return `unknown object "${change.object}"`;
      if (!object.portable) return `the ${object.name} cannot be carried`;
      if (object.heldBy) return `the ${object.name} is already being held`;
      if (object.zone !== agent.zone) return `${agent.name} is not next to the ${object.name}`;
      if (agent.hiddenIn) return `${agent.name} cannot reach the ${object.name} while hiding`;
      return null;
    }
    case "place": {
      const object = now.objects[change.object];
      if (!object) return `unknown object "${change.object}"`;
      const zone = now.zones[change.zone];
      if (!zone) return `unknown zone "${change.zone}"`;
      const holder = object.heldBy ? now.agents[object.heldBy] : null;
      const from = holder?.zone ?? object.zone;
      if (!from) return `the ${object.name} is nowhere`;
      if (!holder && !object.portable) return `the ${object.name} cannot be moved`;
      const range = holder ? THROW_RANGE : 1; // loose objects can only be knocked into the next zone
      if (distance(now, from, zone.id) > range) return `the ${object.name} cannot travel from ${now.zones[from].name} to ${zone.name}`;
      return null;
    }
    case "set": {
      const object = now.objects[change.object];
      if (!object) return `unknown object "${change.object}"`;
      if (change.key === "on") {
        if (!object.switchable) return `the ${object.name} has no switch`;
        const nearby = actions.some((action) => before.agents[action.actor]?.zone === object.zone);
        if (!nearby) return `nobody is next to the ${object.name} to switch it`;
      }
      if (change.key === "broken" && !object.breakable) return `the ${object.name} cannot break`;
      return null;
    }
  }
}
