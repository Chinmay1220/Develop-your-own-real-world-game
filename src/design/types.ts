// A level as the designer writes it. Code checks it (check.ts) and turns it into a playable room (build.ts).
import type { Duty } from "../game/types.ts";

/** A room covers width × depth cells of the building grid, starting at column col and row row. */
export interface DesignRoom {
  id: string;
  name: string; // starts with "the", e.g. "the main gallery"
  description: string;
  col: number;
  row: number;
  width: number;
  depth: number;
  exit: string; // the exit's name, e.g. "the back door", or "" if the room has none
}

export interface DesignConnection {
  from: string;
  to: string;
  kind: "doorway" | "door";
}

/** One simple shape of a thing's look. The centre is in metres from the middle of its footprint; y is the height above the floor. */
export interface Part {
  shape: string; // box, sphere, cylinder or cone
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: string; // #rrggbb
}

export interface DesignObject {
  id: string;
  name: string;
  kind: string; // from the catalog: how it plays
  room: string; // "" if the player starts holding it
  notes: string;
  lights: string[]; // for lights: the rooms they light; [] means their own room
  parts?: Part[]; // its own look, when nothing in the catalog looks like it; empty for the catalog's look
}

export interface DesignHunter {
  id: string;
  name: string;
  look: string;
  color?: string; // #rrggbb, or "" for the look's own colours
  room: string;
  duty: Duty;
  post: string;
  route: string[]; // for patrols
}

export interface DesignFact {
  text: string;
  object: string; // "" if none
  forbids: string; // "" if none
}

export interface GameDesign {
  title: string;
  story: string;
  note: string; // how the designer fitted the request into the game
  missing?: string[]; // what the player asked for that the game can't show or do
  style: string;
  rooms: DesignRoom[];
  connections: DesignConnection[];
  objects: DesignObject[];
  target: string;
  player: { look: string; color?: string; room: string };
  hunters: DesignHunter[];
  facts: DesignFact[];
  maxSteps: number;
}
