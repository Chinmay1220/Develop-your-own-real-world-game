// The four scripted rounds behind `npm run demo`. The tests replay the same script.
import type { PlayerAction } from "./game/session.ts";

export interface DemoRound {
  title: string;
  idea: string;
  actions: PlayerAction[];
}

export const DEMO_ROUNDS: DemoRound[] = [
  {
    title: "The shoe trick",
    idea: "Throw a shoe to lure the guards away, grab the laptop, and leave by the window.",
    actions: [
      { kind: "throw", item: "shoe", target: "bathroom" },
      { kind: "wait" },
      { kind: "move", target: "desk" },
      { kind: "take", target: "laptop" },
      { kind: "move", target: "window" },
    ],
  },
  {
    title: "The same trick again",
    idea: "Try the shoe trick a second time. Also test the world model by hiding under the bed.",
    actions: [
      { kind: "throw", item: "shoe", target: "bathroom" },
      { kind: "move", target: "bed" },
      { kind: "free", text: "hide under the bed" },
      { kind: "move", target: "window" },
      { kind: "move", target: "desk" },
    ],
  },
  {
    title: "A new trick: darkness",
    idea: "Lure one guard with the shoe, switch off the only lamp, and sneak to the laptop in the dark.",
    actions: [
      { kind: "throw", item: "shoe", target: "bathroom" },
      { kind: "move", target: "bed" },
      { kind: "free", text: "turn off the lamp" },
      { kind: "move", target: "window" },
      { kind: "move", target: "desk" },
      { kind: "take", target: "laptop" },
      { kind: "move", target: "window" },
    ],
  },
  {
    title: "Both tricks again",
    idea: "Repeat the darkness trick, and try hiding under the bed one more time.",
    actions: [
      { kind: "throw", item: "shoe", target: "bathroom" },
      { kind: "move", target: "bed" },
      { kind: "free", text: "hide under the bed" },
      { kind: "free", text: "turn off the lamp" },
      { kind: "move", target: "window" },
      { kind: "move", target: "desk" },
    ],
  },
];
