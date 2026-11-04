// Loads a room file and checks it for broken references.
// In the full game an AI (the world builder) writes room files from a photo, so this check matters.
import { readFileSync } from "node:fs";
import type { Room } from "./types.ts";

export function loadRoom(path: string): Room {
  const room = JSON.parse(readFileSync(path, "utf8")) as Room;
  const problems = validateRoom(room);
  if (problems.length > 0) throw new Error(`Room file ${path} has problems:\n- ${problems.join("\n- ")}`);
  return room;
}

export function validateRoom(room: Room): string[] {
  const problems: string[] = [];
  const zones = new Map(room.zones.map((zone) => [zone.id, zone]));
  const objectIds = new Set(room.objects.map((object) => object.id));
  const agentIds = new Set(room.agents.map((agent) => agent.id));

  if (zones.size !== room.zones.length) problems.push("Two zones share an id");
  if (objectIds.size !== room.objects.length) problems.push("Two objects share an id");
  if (agentIds.size !== room.agents.length) problems.push("Two characters share an id");

  for (const zone of room.zones) {
    for (const id of zone.neighbors) {
      const other = zones.get(id);
      if (!other) problems.push(`Zone "${zone.id}" has unknown neighbor "${id}"`);
      else if (!other.neighbors.includes(zone.id)) problems.push(`Zones "${zone.id}" and "${id}" must list each other as neighbors`);
    }
    for (const id of zone.sees) {
      const other = zones.get(id);
      if (!other) problems.push(`Zone "${zone.id}" sees unknown zone "${id}"`);
      else if (!other.sees.includes(zone.id)) problems.push(`Zones "${zone.id}" and "${id}" must see each other`);
    }
  }
  if (!room.zones.some((zone) => zone.exit)) problems.push("The room needs at least one exit zone");

  for (const object of room.objects) {
    if (object.zone === null && object.heldBy === null) problems.push(`Object "${object.id}" is nowhere: give it a zone or a holder`);
    if (object.zone !== null && !zones.has(object.zone)) problems.push(`Object "${object.id}" is in unknown zone "${object.zone}"`);
    if (object.heldBy !== null && !agentIds.has(object.heldBy)) problems.push(`Object "${object.id}" is held by unknown character "${object.heldBy}"`);
  }

  for (const agent of room.agents) {
    if (!zones.has(agent.zone)) problems.push(`Character "${agent.id}" starts in unknown zone "${agent.zone}"`);
    if (agent.post && !zones.has(agent.post)) problems.push(`Guard "${agent.id}" has unknown post "${agent.post}"`);
  }
  if (room.agents.filter((agent) => agent.role === "thief").length !== 1) problems.push("The room needs exactly one thief");
  if (!objectIds.has(room.targetId)) problems.push(`Target "${room.targetId}" is not an object in the room`);

  for (const fact of room.facts) {
    if (fact.object && !objectIds.has(fact.object)) problems.push(`A fact mentions unknown object "${fact.object}"`);
  }
  return problems;
}
