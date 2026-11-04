// A hand-made design. The offline designer returns it, and the tests use it.
// Like the bed in the sample bedroom, one fact plants a mistake for the teacher to catch:
// the catalog says statues can be hidden behind, but this knight stands flat against the wall.
import type { GameDesign } from "./types.ts";

export const EXAMPLE_DESIGN: GameDesign = {
  title: "The Midnight Museum",
  story:
    "You slipped into the City Museum through the loading dock at midnight. The Star of Dawn diamond rests in a glass case in the diamond room. Take it and get out before the night guards catch you.",
  note: "",
  style: "museum",
  rooms: [
    { id: "loading_dock", name: "the loading dock", description: "A cold concrete bay full of shipping crates.", col: 0, row: 2, width: 1, depth: 1, exit: "the loading dock door" },
    { id: "storage", name: "the storage room", description: "A dusty room of shelves, with the museum's power box on the wall.", col: 0, row: 1, width: 1, depth: 1, exit: "" },
    { id: "hall", name: "the long hall", description: "A long corridor with velvet curtains and benches for visitors.", col: 1, row: 1, width: 1, depth: 2, exit: "" },
    { id: "gallery", name: "the main gallery", description: "A wide marble hall of statues and paintings.", col: 2, row: 1, width: 2, depth: 1, exit: "" },
    { id: "diamond_room", name: "the diamond room", description: "A small dark room where a spotlight shines on the diamond.", col: 2, row: 2, width: 1, depth: 1, exit: "" },
    { id: "office", name: "the security office", description: "A cramped office with screens, lockers and cold coffee.", col: 3, row: 2, width: 1, depth: 1, exit: "the fire exit" },
  ],
  connections: [
    { from: "loading_dock", to: "storage", kind: "door" },
    { from: "loading_dock", to: "hall", kind: "doorway" },
    { from: "storage", to: "hall", kind: "door" },
    { from: "hall", to: "gallery", kind: "doorway" },
    { from: "hall", to: "diamond_room", kind: "door" },
    { from: "gallery", to: "diamond_room", kind: "doorway" },
    { from: "gallery", to: "office", kind: "door" },
    { from: "diamond_room", to: "office", kind: "door" },
  ],
  objects: [
    { id: "dock_crates", name: "shipping crates", kind: "crates", room: "loading_dock", notes: "Crates stacked higher than a person.", lights: [] },
    { id: "storage_crates", name: "dusty crates", kind: "crates", room: "storage", notes: "Old crates of spare picture frames.", lights: [] },
    { id: "storage_shelf", name: "storage shelf", kind: "bookshelf", room: "storage", notes: "Metal shelves of cleaning supplies.", lights: [] },
    { id: "power_box", name: "power box", kind: "fuse_box", room: "storage", notes: "The main switch for the hall and gallery lights.", lights: ["hall", "gallery"] },
    { id: "hall_bench", name: "visitor bench", kind: "bench", room: "hall", notes: "A long wooden bench.", lights: [] },
    { id: "palm", name: "potted palm", kind: "plant", room: "hall", notes: "A tall palm in a brass pot.", lights: [] },
    { id: "hall_curtains", name: "velvet curtains", kind: "curtains", room: "hall", notes: "Heavy red curtains that reach the floor.", lights: [] },
    { id: "knight_statue", name: "knight statue", kind: "statue", room: "gallery", notes: "A knight in armour, flat against the north wall.", lights: [] },
    { id: "queen_statue", name: "marble queen", kind: "statue", room: "gallery", notes: "A marble queen on a wide base in the middle of the room.", lights: [] },
    { id: "painting", name: "sunflower painting", kind: "painting", room: "gallery", notes: "A small, famous painting in a gold frame.", lights: [] },
    { id: "gallery_bench", name: "gallery bench", kind: "bench", room: "gallery", notes: "A bench facing the paintings.", lights: [] },
    { id: "vase", name: "Ming vase", kind: "vase", room: "gallery", notes: "A thin porcelain vase on a pedestal. It would shatter loudly.", lights: [] },
    { id: "vase_pedestal", name: "vase pedestal", kind: "pedestal", room: "gallery", notes: "A marble pedestal.", lights: [] },
    { id: "diamond_case", name: "diamond case", kind: "display_case", room: "diamond_room", notes: "A glass case with a lid that lifts open.", lights: [] },
    { id: "diamond", name: "Star of Dawn", kind: "gem", room: "diamond_room", notes: "A diamond the size of an egg, inside the glass case.", lights: [] },
    { id: "spotlight", name: "spotlight lamp", kind: "lamp", room: "diamond_room", notes: "The only light in the diamond room.", lights: [] },
    { id: "security_desk", name: "security desk", kind: "desk", room: "office", notes: "A desk covered in camera screens.", lights: [] },
    { id: "lockers", name: "staff lockers", kind: "lockers", room: "office", notes: "Tall lockers, one of them unlocked.", lights: [] },
    { id: "office_switch", name: "office lights", kind: "light_switch", room: "office", notes: "The switch for the office ceiling lights.", lights: [] },
    { id: "keycard", name: "staff keycard", kind: "keycard", room: "office", notes: "A guard's keycard on a lanyard.", lights: [] },
    { id: "mug", name: "coffee mug", kind: "mug", room: "office", notes: "A ceramic mug of cold coffee.", lights: [] },
    { id: "toy_mouse", name: "wind-up mouse", kind: "toy", room: "", notes: "A clockwork mouse that rattles across the floor.", lights: [] },
  ],
  target: "diamond",
  player: { look: "thief", room: "loading_dock" },
  hunters: [
    { id: "rosa", name: "Guard Rosa", look: "guard", room: "diamond_room", duty: "target", post: "diamond_room", route: [] },
    { id: "milo", name: "Guard Milo", look: "guard", room: "gallery", duty: "patrol", post: "gallery", route: ["gallery", "hall"] },
    { id: "unit7", name: "Unit 7", look: "robot", room: "office", duty: "exit", post: "office", route: [] },
  ],
  facts: [
    { text: "The knight statue stands flat against the wall, so nobody can hide behind it.", object: "knight_statue", forbids: "hide" },
    { text: "The diamond case is armoured glass. It cannot be broken, but its lid lifts open.", object: "diamond_case", forbids: "" },
    { text: "The power box in the storage room controls the lights of the long hall and the main gallery.", object: "power_box", forbids: "" },
  ],
  maxSteps: 30,
};
