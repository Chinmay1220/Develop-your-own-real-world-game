// Checks that a designed level can be built and played. Each problem is written as an instruction
// the designer can act on, because the problems go back to it to fix.
import { CATALOG, FORBIDDABLE, isFurniture, LOOKS, MAX_PARTS, STYLES, type CatalogItem } from "./catalog.ts";
import type { DesignRoom, GameDesign } from "./types.ts";

export const GRID = 4; // the building is at most 4 × 4 cells
const ID = /^[a-z][a-z0-9_]*$/;
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function catalogItem(kind: string): CatalogItem | undefined {
  return Object.hasOwn(CATALOG, kind) ? CATALOG[kind] : undefined;
}

export function cellsOf(room: DesignRoom): [number, number][] {
  const cells: [number, number][] = [];
  for (let col = room.col; col < room.col + room.width; col++) {
    for (let row = room.row; row < room.row + room.depth; row++) cells.push([col, row]);
  }
  return cells;
}

/** True when the two rooms share a stretch of wall. */
export function touching(a: DesignRoom, b: DesignRoom): boolean {
  const other = new Set(cellsOf(b).map(([col, row]) => `${col},${row}`));
  return cellsOf(a).some(([col, row]) => SIDES.some(([dc, dr]) => other.has(`${col + dc},${row + dr}`)));
}

/** How many rooms away every reachable room is, following the connections. */
function distancesFrom(start: string, links: Map<string, Set<string>>): Map<string, number> {
  const distances = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length > 0) {
    const room = queue.shift()!;
    for (const next of links.get(room) ?? []) {
      if (distances.has(next)) continue;
      distances.set(next, distances.get(room)! + 1);
      queue.push(next);
    }
  }
  return distances;
}

export function checkDesign(design: GameDesign): string[] {
  const problems: string[] = [];
  const rooms = new Map(design.rooms.map((room) => [room.id, room]));
  const objects = new Map(design.objects.map((object) => [object.id, object]));

  const ids = new Set<string>();
  for (const { id } of [...design.rooms, ...design.objects, ...design.hunters]) {
    if (!ID.test(id)) problems.push(`The id "${id}" must use only lowercase letters, digits and underscores, starting with a letter`);
    else if (id === "thief") problems.push(`The id "thief" is kept for the player. Use another id`);
    else if (ids.has(id)) problems.push(`The id "${id}" is used more than once`);
    ids.add(id);
  }
  if (!design.title.trim()) problems.push("Give the level a title");
  if (!Object.hasOwn(STYLES, design.style)) problems.push(`Unknown style "${design.style}"`);
  if (!Object.hasOwn(LOOKS, design.player.look)) problems.push(`Unknown player look "${design.player.look}"`);

  // Rooms sit on the grid without overlapping.
  if (design.rooms.length < 3 || design.rooms.length > 7) problems.push(`Use 3 to 7 rooms, not ${design.rooms.length}`);
  const owner = new Map<string, string>();
  for (const room of design.rooms) {
    if (![1, 2].includes(room.width) || ![1, 2].includes(room.depth)) {
      problems.push(`Room "${room.id}" must be 1 or 2 cells wide and deep`);
      continue;
    }
    if (room.col < 0 || room.row < 0 || room.col + room.width > GRID || room.row + room.depth > GRID) {
      problems.push(`Room "${room.id}" goes outside the ${GRID} × ${GRID} grid`);
      continue;
    }
    for (const [col, row] of cellsOf(room)) {
      const other = owner.get(`${col},${row}`);
      if (other) problems.push(`Rooms "${other}" and "${room.id}" overlap at column ${col}, row ${row}`);
      else owner.set(`${col},${row}`, room.id);
    }
  }

  // Connections join rooms that share a wall, and every room can be reached.
  const links = new Map(design.rooms.map((room) => [room.id, new Set<string>()]));
  for (const link of design.connections) {
    const from = rooms.get(link.from);
    const to = rooms.get(link.to);
    if (!from || !to) {
      problems.push(`A connection names unknown room "${from ? link.to : link.from}"`);
      continue;
    }
    if (from === to) {
      problems.push(`A connection joins "${from.id}" to itself`);
      continue;
    }
    if (links.get(from.id)!.has(to.id)) {
      problems.push(`Rooms "${from.id}" and "${to.id}" are connected twice`);
      continue;
    }
    if (!touching(from, to)) problems.push(`Rooms "${from.id}" and "${to.id}" are connected but do not share a wall. Move them side by side or remove the connection`);
    links.get(from.id)!.add(to.id);
    links.get(to.id)!.add(from.id);
  }
  const start = rooms.get(design.player.room);
  if (!start) problems.push(`The player starts in unknown room "${design.player.room}"`);
  const reach = start ? distancesFrom(start.id, links) : new Map<string, number>();
  if (start) {
    for (const room of design.rooms) {
      if (!reach.has(room.id)) problems.push(`Room "${room.id}" cannot be reached from the player's start, "${start.id}". Connect it to a room next to it`);
    }
  }

  const exits = design.rooms.filter((room) => room.exit.trim() !== "");
  if (exits.length === 0) problems.push("No room has an exit. Give at least one room on the outside of the building an exit");
  for (const room of exits) {
    const outside = cellsOf(room).some(([col, row]) => SIDES.some(([dc, dr]) => !owner.has(`${col + dc},${row + dr}`)));
    if (!outside) problems.push(`Room "${room.id}" has an exit but no outside wall: other rooms surround it`);
  }

  // Objects come from the catalog and fit in their rooms.
  if (design.objects.length < 6 || design.objects.length > 28) problems.push(`Use 8 to 24 objects, not ${design.objects.length}`);
  for (const object of design.objects) {
    const item = catalogItem(object.kind);
    if (!item) {
      problems.push(`Object "${object.id}" has unknown kind "${object.kind}"`);
      continue;
    }
    if (object.room === "") {
      if (!item.portable) problems.push(`Object "${object.id}" (${object.kind}) is too big for the player to carry. Put it in a room`);
    } else if (!rooms.has(object.room)) {
      problems.push(`Object "${object.id}" is in unknown room "${object.room}"`);
    } else if (item.minCells) {
      const room = rooms.get(object.room)!;
      if (room.width * room.depth < item.minCells) problems.push(`Object "${object.id}" (${object.kind}) needs a room of at least ${item.minCells} cells, but "${room.id}" has ${room.width * room.depth}`);
    }
    if (item.light) {
      for (const id of object.lights) if (!rooms.has(id)) problems.push(`Light "${object.id}" lights unknown room "${id}"`);
    }
    if ((object.parts?.length ?? 0) > MAX_PARTS) problems.push(`Object "${object.id}" is drawn with ${object.parts!.length} shapes; use at most ${MAX_PARTS}`);
  }
  const carried = design.objects.filter((object) => object.room === "");
  if (carried.length > 2) problems.push(`The player may start holding at most 2 things, not ${carried.length}`);
  for (const room of design.rooms) {
    const furniture = design.objects.filter((object) => {
      const item = object.room === room.id ? catalogItem(object.kind) : undefined;
      return item !== undefined && isFurniture(item);
    }).length;
    const limit = 4 * room.width * room.depth + 1;
    if (furniture > limit) problems.push(`Room "${room.id}" has ${furniture} pieces of furniture but only fits ${limit}. Remove some or make the room bigger`);
  }
  if (!design.objects.some((object) => catalogItem(object.kind)?.hide)) problems.push("Add at least one place to hide");
  if (!design.objects.some((object) => object.id !== design.target && catalogItem(object.kind)?.portable)) {
    problems.push("Add at least one thing the player can throw to make a noise");
  }

  const target = objects.get(design.target);
  if (!target) problems.push(`The target "${design.target}" is not one of the objects`);
  else if (!catalogItem(target.kind)?.portable) problems.push(`The target "${target.id}" is a ${target.kind}, which cannot be carried. Choose a kind the player can carry`);
  else if (target.room === "") problems.push("The player cannot start holding the target. Put it in a room");
  else if (target.room === design.player.room) problems.push("The target is in the player's start room. Put it at least two rooms away");

  // Hunters start out of the player's sight.
  if (design.hunters.length < 1 || design.hunters.length > 4) problems.push(`Use 1 to 4 hunters, not ${design.hunters.length}`);
  for (const hunter of design.hunters) {
    if (!Object.hasOwn(LOOKS, hunter.look)) problems.push(`Hunter "${hunter.id}" has unknown look "${hunter.look}"`);
    if (!rooms.has(hunter.room)) problems.push(`Hunter "${hunter.id}" starts in unknown room "${hunter.room}"`);
    if (!rooms.has(hunter.post)) problems.push(`Hunter "${hunter.id}" has unknown post "${hunter.post}"`);
    if (hunter.duty === "patrol") {
      if (hunter.route.length < 2) problems.push(`Hunter "${hunter.id}" patrols, so its route needs at least 2 rooms`);
      for (const id of hunter.route) if (!rooms.has(id)) problems.push(`Hunter "${hunter.id}" has unknown room "${id}" in its route`);
    }
    if (!start) continue;
    if (hunter.room === start.id) {
      problems.push(`Hunter "${hunter.id}" starts in the player's start room, so the player would be caught at once. Move the hunter`);
    } else if (design.connections.some((link) => link.kind === "doorway" && [link.from, link.to].includes(hunter.room) && [link.from, link.to].includes(start.id))) {
      problems.push(`Hunter "${hunter.id}" can see into the player's start room through an open doorway. Start the hunter further away, or make that a door`);
    }
  }

  for (const fact of design.facts) {
    if (fact.object && !objects.has(fact.object)) problems.push(`A fact is about unknown object "${fact.object}"`);
    if (fact.forbids && !FORBIDDABLE.includes(fact.forbids)) problems.push(`A fact forbids unknown action "${fact.forbids}"`);
  }

  if (!Number.isInteger(design.maxSteps) || design.maxSteps < 15 || design.maxSteps > 50) {
    problems.push(`maxSteps must be between 20 and 40, not ${design.maxSteps}`);
  } else if (target && reach.has(target.room)) {
    const fromTarget = distancesFrom(target.room, links);
    const shortest = reach.get(target.room)! + Math.min(...exits.map((room) => fromTarget.get(room.id) ?? Infinity));
    if (Number.isFinite(shortest) && design.maxSteps < 2 * shortest + 4) {
      problems.push(`maxSteps ${design.maxSteps} is too few: the shortest way to the target and out takes ${shortest} steps. Use at least ${2 * shortest + 4}`);
    }
  }
  return problems;
}
