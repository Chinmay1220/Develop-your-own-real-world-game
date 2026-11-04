// Small helpers for reading and changing the world state.
import type { Action, Agent, AgentId, Change, ObjectId, Room, WorldObject, WorldState, ZoneId } from "./types.ts";

export function createState(room: Room): WorldState {
  const copy = structuredClone(room);
  return {
    roomId: copy.id,
    roomName: copy.name,
    description: copy.description,
    targetId: copy.targetId,
    maxSteps: copy.maxSteps,
    step: 0,
    status: "playing",
    zones: Object.fromEntries(copy.zones.map((zone) => [zone.id, zone])),
    objects: Object.fromEntries(copy.objects.map((object) => [object.id, object])),
    agents: Object.fromEntries(copy.agents.map((agent) => [agent.id, agent])),
  };
}

export function getThief(state: WorldState): Agent {
  const thief = Object.values(state.agents).find((agent) => agent.role === "thief");
  if (!thief) throw new Error("The room has no thief");
  return thief;
}

export function getGuards(state: WorldState): Agent[] {
  return Object.values(state.agents).filter((agent) => agent.role === "guard");
}

/** A zone is lit when a working light that reaches it is on. A zone no light reaches is never dark. */
export function isLit(state: WorldState, zone: ZoneId): boolean {
  const lights = Object.values(state.objects).filter((object) => object.lightSource && (!object.lights || object.lights.includes(zone)));
  return lights.length === 0 || lights.some((light) => light.on && !light.broken);
}

/** Shortest path between two zones. Follows each zone's neighbor order, so results are repeatable. */
export function findPath(state: WorldState, from: ZoneId, to: ZoneId): ZoneId[] | null {
  if (from === to) return [from];
  const parent = new Map<ZoneId, ZoneId>([[from, from]]);
  const queue = [from];
  while (queue.length > 0) {
    const zone = queue.shift()!;
    for (const next of state.zones[zone]?.neighbors ?? []) {
      if (parent.has(next)) continue;
      parent.set(next, zone);
      if (next === to) {
        const path = [to];
        while (path[0] !== from) path.unshift(parent.get(path[0])!);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

export function distance(state: WorldState, from: ZoneId, to: ZoneId): number {
  const path = findPath(state, from, to);
  return path ? path.length - 1 : Infinity;
}

/** The next zone on the way from one zone to another, or the start zone if there is no way. */
export function stepToward(state: WorldState, from: ZoneId, to: ZoneId): ZoneId {
  const path = findPath(state, from, to);
  return path && path.length > 1 ? path[1] : from;
}

/** Zones a character standing here can see: their own zone, and the lit zones in view. */
export function visibleZones(state: WorldState, zone: ZoneId): ZoneId[] {
  return [zone, ...(state.zones[zone]?.sees ?? []).filter((other) => isLit(state, other))];
}

export function objectsIn(state: WorldState, zone: ZoneId): WorldObject[] {
  return Object.values(state.objects).filter((object) => object.zone === zone && object.heldBy === null);
}

export function heldItems(state: WorldState, agentId: AgentId): WorldObject[] {
  return Object.values(state.objects).filter((object) => object.heldBy === agentId);
}

export function hiddenCount(state: WorldState, objectId: ObjectId): number {
  return Object.values(state.agents).filter((agent) => agent.hiddenIn === objectId).length;
}

export function hidePhrase(object: WorldObject): string {
  return object.hidePhrase ?? `in the ${object.name}`;
}

/** Applies one change that the checker has already accepted. */
export function applyChange(state: WorldState, change: Change): void {
  switch (change.op) {
    case "move": {
      const agent = state.agents[change.actor];
      agent.hiddenIn = null; // moving always means leaving a hiding spot
      agent.zone = change.to;
      return;
    }
    case "hide":
      state.agents[change.actor].hiddenIn = change.object;
      return;
    case "unhide":
      state.agents[change.actor].hiddenIn = null;
      return;
    case "pickUp": {
      const object = state.objects[change.object];
      object.heldBy = change.actor;
      object.zone = null;
      return;
    }
    case "place": {
      const object = state.objects[change.object];
      object.heldBy = null;
      object.zone = change.zone;
      return;
    }
    case "set":
      state.objects[change.object][change.key] = change.value;
      return;
  }
}

/** The action in plain words, used in the story log and in prompts. */
export function describeAction(state: WorldState, action: Omit<Action, "text"> & { text?: string }): string {
  const zone = (id?: string) => (id && state.zones[id]?.name) || id || "somewhere";
  const thing = (id?: string) => (id && state.objects[id] ? `the ${state.objects[id].name}` : id || "something");
  const object = action.target ? state.objects[action.target] : undefined;
  switch (action.kind) {
    case "move":
      return `move to ${zone(action.target)}`;
    case "take":
      return `take ${thing(action.target)}`;
    case "drop":
      return `drop ${thing(action.target)}`;
    case "hide":
      return object ? `hide ${hidePhrase(object)}` : "hide";
    case "unhide":
      return "come out of hiding";
    case "throw":
      return `throw ${thing(action.item)} at ${zone(action.target)}`;
    case "use":
      return object?.switchable ? `switch ${thing(action.target)} ${object.on ? "off" : "on"}` : `use ${thing(action.target)}`;
    case "search":
      return object ? `search ${hidePhrase(object)}` : "search";
    case "wait":
    case "free":
      return action.text || "wait";
  }
}
