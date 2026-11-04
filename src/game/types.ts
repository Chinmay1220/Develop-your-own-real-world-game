// Data shapes shared by the engine, the AI roles and the browser.
// The engine owns the hard rules. The world model only proposes Changes in this vocabulary,
// and the checker decides which of them are allowed.

export type ZoneId = string;
export type ObjectId = string;
export type AgentId = string;

export type Loudness = 1 | 2 | 3;
export type Role = "thief" | "guard";
export type Duty = "target" | "exit" | "patrol";
export type RoundStatus = "playing" | "escaped" | "caught" | "timeout";

/** An area a character can stand in. In the full game the world builder makes these from the photo. */
export interface Zone {
  id: ZoneId;
  name: string; // a noun phrase, e.g. "the window"
  x: number; // map position, 0–100
  y: number;
  neighbors: ZoneId[]; // reachable in one step
  sees: ZoneId[]; // visible from here while they are lit
  exit?: boolean; // the thief escapes here when carrying the target
  exitName?: string; // e.g. "the back door"
}

export interface WorldObject {
  id: ObjectId;
  name: string;
  kind?: string; // what the 3D game draws, from the catalog in src/design/catalog.ts
  parts?: { shape: string; x: number; y: number; z: number; w: number; h: number; d: number; color: string }[]; // a designed look instead
  aliases?: string[];
  notes?: string; // what the world builder saw; given to the world model
  zone: ZoneId | null; // null while someone holds it
  heldBy: AgentId | null;
  portable?: boolean;
  hideCapacity?: number; // how many characters fit inside, under or behind it
  hidePhrase?: string; // e.g. "under the bed"
  switchable?: boolean;
  lightSource?: boolean;
  lights?: ZoneId[]; // the zones a light source lights; every zone if left out
  on?: boolean;
  breakable?: boolean;
  broken?: boolean;
  loudness?: Loudness; // how loud it lands when thrown
}

export interface Agent {
  id: AgentId;
  name: string;
  role: Role;
  zone: ZoneId;
  hiddenIn: ObjectId | null;
  post?: ZoneId; // guards return here when nothing is happening
  duty?: Duty;
  route?: ZoneId[]; // the zones a patrolling guard walks through, in order
  look?: string; // how the 3D game draws the character, e.g. "guard", "ghost" or "ant"
  color?: string; // #rrggbb for creatures
}

/** Ground truth about the real place. The teacher checks the world model against these. */
export interface Fact {
  text: string;
  object?: ObjectId;
  forbids?: ActionKind; // lets the offline teacher check the fact without an AI
}

/** Where each zone sits in a building made of square cells, so the 3D game can build it. */
export interface Layout {
  style: string; // the look of the place, e.g. "museum"
  cell: number; // metres per cell
  areas: { zone: ZoneId; col: number; row: number; width: number; depth: number }[];
  doors: { from: ZoneId; to: ZoneId; kind: "doorway" | "door" }[]; // a doorway can be seen through, a door cannot
}

export interface Room {
  id: string;
  name: string;
  description: string;
  maxSteps: number;
  targetId: ObjectId;
  facts: Fact[];
  zones: Zone[];
  objects: WorldObject[];
  agents: Agent[];
  story?: string; // shown to the player before the game starts
  prompt?: string; // the words a designed level was made from
  note?: string; // how the designer fitted those words into the game
  missing?: string[]; // what the words asked for that the game can't show or do
  layout?: Layout; // designed levels have one
}

export interface WorldState {
  roomId: string;
  roomName: string;
  description: string;
  targetId: ObjectId;
  maxSteps: number;
  step: number;
  status: RoundStatus;
  zones: Record<ZoneId, Zone>;
  objects: Record<ObjectId, WorldObject>;
  agents: Record<AgentId, Agent>;
}

export type ActionKind = "move" | "take" | "drop" | "hide" | "unhide" | "throw" | "use" | "search" | "wait" | "free";

export interface Action {
  actor: AgentId;
  kind: ActionKind;
  target?: string; // zone id for move/throw, object id for take/drop/hide/use/search
  item?: ObjectId; // what is thrown
  text: string; // the action in words; for "free" actions, exactly what the player typed
}

export type Change =
  | { op: "move"; actor: AgentId; to: ZoneId }
  | { op: "hide"; actor: AgentId; object: ObjectId }
  | { op: "unhide"; actor: AgentId }
  | { op: "pickUp"; actor: AgentId; object: ObjectId }
  | { op: "place"; object: ObjectId; zone: ZoneId }
  | { op: "set"; object: ObjectId; key: "on" | "broken"; value: boolean };

export interface Noise {
  zone: ZoneId;
  loudness: Loudness;
  what: string;
}

/** What the world model says happened during one step. */
export interface Outcome {
  changes: Change[];
  noises: Noise[];
  narration: string[];
  unreadable?: string[]; // changes the world model sent in a shape the game could not read
}

export interface Rejection {
  what: string; // the blocked change or noise, as JSON
  reason: string;
}

export interface StepRecord {
  step: number;
  actions: Action[];
  narration: string[];
  accepted: Change[];
  rejected: Rejection[];
  noises: Noise[];
  events: string[]; // decided by code: searches, catches, escapes
  status: RoundStatus;
}

/** What one guard notices at the end of a step. Guards never get the full state. */
export interface Observation {
  zone: ZoneId;
  lit: boolean;
  visibleZones: ZoneId[];
  thiefSeenAt: ZoneId | null;
  sawHideIn: ObjectId | null;
  heard: Noise[];
  lightsWentOut: boolean;
}
