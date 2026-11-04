// Turns a checked design into a room the game engine plays, with the layout the 3D game builds from.
// Each designed room becomes one zone.
import type { ActionKind, Agent, Room, WorldObject, Zone } from "../game/types.ts";
import { MAX_PARTS, SHAPES } from "./catalog.ts";
import { catalogItem } from "./check.ts";
import type { GameDesign, Part } from "./types.ts";

export const CELL = 6; // metres per grid cell
const HEX = /^#[0-9a-f]{6}$/i;

/** Keeps the designed shapes that make sense: known shapes, real sizes and real colours. */
function cleanParts(parts: Part[] = []): Part[] {
  return parts
    .filter((part) => SHAPES.includes(part.shape) && HEX.test(part.color))
    .filter((part) => [part.x, part.y, part.z, part.w, part.h, part.d].every(Number.isFinite) && Math.min(part.w, part.h, part.d) > 0.01 && Math.max(part.w, part.h, part.d) <= 10)
    .slice(0, MAX_PARTS);
}

const colorOf = (color?: string) => (color && HEX.test(color) ? { color } : {});

/** "main gallery" → "the main gallery", but "the vault" and "Grandma's attic" stay as they are. */
function nounPhrase(text: string): string {
  const clean = text.trim();
  return /^(the|a|an|my|your|our|his|her|their)\b/i.test(clean) || /^\p{Lu}\S*'s\b/u.test(clean) ? clean : `the ${clean}`;
}

const bare = (name: string) => name.trim().replace(/^the\s+/i, "");
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function levelId(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "level"
  );
}

export function buildRoom(design: GameDesign, prompt = ""): Room {
  // The 2D map spreads the used part of the grid over 10–90.
  const left = Math.min(...design.rooms.map((room) => room.col));
  const top = Math.min(...design.rooms.map((room) => room.row));
  const columns = Math.max(...design.rooms.map((room) => room.col + room.width)) - left;
  const rows = Math.max(...design.rooms.map((room) => room.row + room.depth)) - top;
  const linked = (id: string, open: boolean) =>
    design.connections
      .filter((link) => (link.from === id || link.to === id) && (!open || link.kind === "doorway"))
      .map((link) => (link.from === id ? link.to : link.from));

  const zones: Zone[] = design.rooms.map((room) => ({
    id: room.id,
    name: nounPhrase(room.name),
    x: Math.round(10 + (80 * (room.col - left + room.width / 2)) / columns),
    y: Math.round(10 + (80 * (room.row - top + room.depth / 2)) / rows),
    neighbors: linked(room.id, false),
    sees: linked(room.id, true), // only open doorways can be seen through
    ...(room.exit.trim() ? { exit: true, exitName: nounPhrase(room.exit) } : {}),
  }));

  const objects: WorldObject[] = design.objects.map((object) => {
    const item = catalogItem(object.kind)!;
    const name = bare(object.name);
    const parts = cleanParts(object.parts);
    return {
      id: object.id,
      name,
      kind: object.kind,
      ...(parts.length > 0 ? { parts } : {}),
      notes: object.notes,
      zone: object.room || null,
      heldBy: object.room ? null : "thief",
      ...(item.portable ? { portable: true, loudness: item.loudness } : {}),
      ...(item.hide ? { hideCapacity: 1, hidePhrase: item.hide.replace("{name}", name) } : {}),
      ...(item.breakable ? { breakable: true, broken: false } : {}),
      ...(item.light ? { switchable: true, lightSource: true, on: true, lights: object.lights.length > 0 ? [...new Set(object.lights)] : [object.room] } : {}),
    };
  });

  const agents: Agent[] = [
    { id: "thief", name: "You", role: "thief", zone: design.player.room, hiddenIn: null, look: design.player.look, ...colorOf(design.player.color) },
    ...design.hunters.map(
      (hunter): Agent => ({
        id: hunter.id,
        name: hunter.name,
        role: "guard",
        zone: hunter.room,
        hiddenIn: null,
        post: hunter.post,
        duty: hunter.duty,
        ...(hunter.duty === "patrol" ? { route: hunter.route } : {}),
        look: hunter.look,
        ...colorOf(hunter.color),
      }),
    ),
  ];

  const roomLines = design.rooms.map((room) => `${capitalize(nounPhrase(room.name))}: ${room.description}`);
  return {
    id: levelId(design.title),
    name: design.title,
    description: [design.story, ...roomLines].join(" "),
    maxSteps: design.maxSteps,
    targetId: design.target,
    facts: design.facts.map((fact) => ({
      text: fact.text,
      ...(fact.object ? { object: fact.object } : {}),
      ...(fact.forbids ? { forbids: fact.forbids as ActionKind } : {}),
    })),
    zones,
    objects,
    agents,
    story: design.story,
    prompt,
    ...(design.note ? { note: design.note } : {}),
    ...(design.missing?.length ? { missing: design.missing } : {}),
    layout: {
      style: design.style,
      cell: CELL,
      areas: design.rooms.map(({ id, col, row, width, depth }) => ({ zone: id, col, row, width, depth })),
      doors: design.connections.map(({ from, to, kind }) => ({ from, to, kind })),
    },
  };
}
