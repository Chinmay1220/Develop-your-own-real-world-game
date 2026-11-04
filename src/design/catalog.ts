// Everything the 3D game can draw, and what each thing can do in the game.
// The designer may only use these kinds, so every level it makes can be built and played.
import type { Loudness } from "../game/types.ts";

export interface CatalogItem {
  what: string; // told to the designer
  size: [number, number, number]; // width, depth and height in metres, for the 3D builder
  place: "wall" | "corner" | "middle" | "on"; // where the 3D builder puts it; "on" means on furniture or the floor
  tall?: boolean; // blocks the view in 3D
  hide?: string; // where someone hides, with {name} for the object's name
  portable?: boolean;
  breakable?: boolean;
  loudness?: Loudness; // how loud it lands when thrown
  light?: boolean; // a light with a switch
  minCells?: number; // big things need a room of at least this many cells
  base?: [number, number]; // the floor space it takes, when smaller than its size (a tree's trunk, not its crown)
}

export const CATALOG: Record<string, CatalogItem> = {
  // Furniture to hide in or behind
  bed: { what: "a bed; hide under it", size: [1.6, 2.1, 0.6], place: "wall", hide: "under the {name}" },
  sofa: { what: "a sofa; hide behind it", size: [2.0, 0.9, 0.85], place: "middle", hide: "behind the {name}" },
  wardrobe: { what: "a tall wardrobe or closet; hide inside", size: [1.2, 0.6, 2.1], place: "wall", tall: true, hide: "inside the {name}" },
  desk: { what: "a desk; hide under it", size: [1.4, 0.7, 0.75], place: "wall", hide: "under the {name}" },
  counter: { what: "a long shop, bar or kitchen counter; hide behind it", size: [2.4, 0.7, 1.0], place: "wall", hide: "behind the {name}" },
  crates: { what: "a stack of wooden crates; hide behind them", size: [1.2, 1.2, 1.6], place: "corner", tall: true, hide: "behind the {name}" },
  barrels: { what: "a group of barrels; hide behind them", size: [1.1, 1.1, 1.1], place: "corner", hide: "behind the {name}" },
  lockers: { what: "a row of tall metal lockers; hide inside", size: [1.6, 0.5, 2.0], place: "wall", tall: true, hide: "inside the {name}" },
  statue: { what: "a big statue; hide behind it", size: [0.9, 0.9, 2.2], place: "middle", tall: true, hide: "behind the {name}" },
  curtains: { what: "long curtains; hide behind them", size: [1.6, 0.2, 2.4], place: "wall", hide: "behind the {name}" },
  server_rack: { what: "a tall rack of computers; hide behind it", size: [0.8, 1.0, 2.0], place: "wall", tall: true, hide: "behind the {name}" },
  car: { what: "a car; hide behind it; needs a room of 2 or more cells", size: [1.9, 4.3, 1.5], place: "middle", hide: "behind the {name}", minCells: 2 },

  // Nature, for outdoor places (and big plants indoors)
  tree: { what: "a big tree with a thick trunk; blocks the view; hide behind it", size: [3.0, 3.0, 6.0], base: [1.3, 1.3], place: "middle", tall: true, hide: "behind the {name}" },
  bush: { what: "a thick bush; hide inside", size: [1.4, 1.4, 1.1], place: "corner", hide: "inside the {name}" },
  rock: { what: "a big rock or boulder; hide behind it", size: [1.4, 1.2, 1.2], place: "middle", hide: "behind the {name}" },
  log: { what: "a fallen hollow log; hide inside", size: [2.6, 0.9, 0.9], place: "middle", hide: "inside the {name}" },
  tall_grass: { what: "a patch of tall grass; hide in it", size: [1.6, 1.6, 0.9], place: "middle", hide: "in the {name}" },
  mushroom: { what: "a giant mushroom", size: [1.0, 1.0, 1.4], place: "middle" },
  flowers: { what: "a bed of flowers", size: [1.4, 1.0, 0.4], place: "middle" },

  // Other furniture
  bookshelf: { what: "a tall bookshelf", size: [1.4, 0.4, 2.0], place: "wall", tall: true },
  table: { what: "a table", size: [1.8, 0.9, 0.75], place: "middle" },
  cabinet: { what: "a low cabinet", size: [1.0, 0.5, 0.9], place: "wall" },
  display_case: { what: "a glass display case; the glass can break loudly", size: [1.0, 1.0, 1.2], place: "middle", breakable: true },
  pedestal: { what: "a stone pedestal that shows off one item", size: [0.6, 0.6, 1.1], place: "middle" },
  fridge: { what: "a fridge", size: [0.8, 0.7, 1.9], place: "wall", tall: true },
  plant: { what: "a big potted plant", size: [0.6, 0.6, 1.5], place: "corner" },
  rug: { what: "a rug on the floor", size: [2.4, 1.6, 0.02], place: "middle" },
  bench: { what: "a bench", size: [1.6, 0.5, 0.45], place: "middle" },

  // Lights
  lamp: { what: "a floor lamp with a switch; it can break", size: [0.45, 0.45, 1.6], place: "corner", light: true, breakable: true },
  light_switch: { what: "a wall switch for the ceiling lights", size: [0.12, 0.05, 0.12], place: "wall", light: true },
  fuse_box: { what: "the power box; switching it off darkens every room it lights", size: [0.5, 0.2, 0.7], place: "wall", light: true },

  // Things the player can carry and throw
  laptop: { what: "a laptop", size: [0.35, 0.25, 0.03], place: "on", portable: true, loudness: 2 },
  gem: { what: "a jewel or diamond", size: [0.08, 0.08, 0.08], place: "on", portable: true, loudness: 1 },
  painting: { what: "a framed painting", size: [0.9, 0.08, 0.7], place: "wall", portable: true, loudness: 2 },
  statuette: { what: "a small statue or idol", size: [0.2, 0.2, 0.35], place: "on", portable: true, loudness: 2 },
  crown: { what: "a crown", size: [0.25, 0.25, 0.15], place: "on", portable: true, loudness: 2 },
  gold: { what: "a gold bar", size: [0.25, 0.1, 0.08], place: "on", portable: true, loudness: 2 },
  documents: { what: "a folder of papers", size: [0.3, 0.22, 0.03], place: "on", portable: true, loudness: 1 },
  keycard: { what: "a key or keycard", size: [0.09, 0.06, 0.01], place: "on", portable: true, loudness: 1 },
  briefcase: { what: "a briefcase", size: [0.45, 0.12, 0.33], place: "on", portable: true, loudness: 2 },
  vase: { what: "a vase that shatters loudly", size: [0.25, 0.25, 0.45], place: "on", portable: true, breakable: true, loudness: 3 },
  bottle: { what: "a glass bottle that shatters loudly", size: [0.08, 0.08, 0.3], place: "on", portable: true, breakable: true, loudness: 3 },
  mug: { what: "a mug that shatters loudly", size: [0.1, 0.1, 0.11], place: "on", portable: true, breakable: true, loudness: 3 },
  book: { what: "a book", size: [0.2, 0.15, 0.04], place: "on", portable: true, loudness: 1 },
  shoe: { what: "a shoe", size: [0.28, 0.11, 0.11], place: "on", portable: true, loudness: 2 },
  toy: { what: "a toy", size: [0.2, 0.2, 0.2], place: "on", portable: true, loudness: 2 },
  pillow: { what: "a pillow that lands softly", size: [0.5, 0.35, 0.12], place: "on", portable: true, loudness: 1 },
  leaf: { what: "a big leaf that lands softly", size: [0.5, 0.35, 0.04], place: "on", portable: true, loudness: 1 },
  berry: { what: "a berry or piece of food", size: [0.16, 0.16, 0.16], place: "on", portable: true, loudness: 1 },
  acorn: { what: "an acorn, nut or seed", size: [0.14, 0.14, 0.18], place: "on", portable: true, loudness: 2 },
};

export const KINDS = Object.keys(CATALOG);

/** Pieces that take floor space. Small things and wall switches don't count. */
export function isFurniture(item: CatalogItem): boolean {
  return !item.portable && item.size[0] * item.size[1] >= 0.25;
}

/** How characters can look: people, or creatures with walking legs. Anyone can be the player or a hunter. */
export const LOOKS: Record<string, string> = {
  thief: "a person in a black stealth suit",
  kid: "a small kid",
  robot: "a silver robot",
  guard: "a security guard",
  soldier: "a soldier in combat gear",
  ghost: "a pale, glowing ghost",
  ant: "an ant",
  beetle: "a beetle",
  spider: "a spider",
  bee: "a bee that hovers",
  dog: "a dog",
  cat: "a cat",
  mouse: "a mouse",
  bird: "a bird",
};

/** Styles without walls: areas are open ground, edged by hedges. */
export const OUTDOOR_STYLES = ["forest", "garden"];

export const STYLES: Record<string, string> = {
  forest: "outdoors: moss, roots and trees; no walls",
  garden: "outdoors: lawn, hedges and flower beds; no walls",
  cave: "rock floors and rough rock walls",
  home: "a lived-in home",
  museum: "marble floors and white walls",
  office: "carpet, glass and grey walls",
  prison: "concrete and steel bars",
  castle: "old stone and torches",
  lab: "white tiles and bright screens",
  school: "lino floors and painted walls",
  shop: "shelves, tiles and bright signs",
  warehouse: "concrete floors and metal walls",
  haunted: "rotten wood and cobwebs",
};

/** Simple shapes the designer can draw a thing with, when nothing in the catalog looks like it. */
export const SHAPES = ["box", "sphere", "cylinder", "cone"];
export const MAX_PARTS = 12;

/** Actions a fact can rule out. */
export const FORBIDDABLE = ["hide", "take", "throw", "use", "search", "move"];
