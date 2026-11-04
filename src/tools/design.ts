// Designs levels from your own words and saves them to data/levels/.
// Run with: npm run design -- "a museum heist at night, steal the diamond, 3 guards"
//           npm run design -- "first idea" "second idea"     (one level for each idea)
// With an API key this uses Meta's designer model, a few cents per level. Without one, the offline
// stand-in returns the built-in museum.
import { createDesigner } from "../ai/index.ts";
import { DesignError, designLevel } from "../design/designer.ts";
import { saveLevel } from "../design/levels.ts";
import type { Room } from "../game/types.ts";

const prompts = process.argv
  .slice(2)
  .map((text) => text.trim())
  .filter(Boolean);
if (prompts.length === 0) {
  console.error('Describe the game you want, for example: npm run design -- "a prison escape with two guards"');
  process.exit(1);
}

const designer = createDesigner();
const spent = () => designer.usage()?.usd ?? 0;
console.log(`Designer: ${designer.model}`);

for (const prompt of prompts) {
  console.log(`\n=== "${prompt}" ===`);
  const costBefore = spent();
  const startedAt = performance.now();
  try {
    const { room, design, attempts } = await designLevel(prompt, designer);
    const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    printFixes(attempts.slice(0, -1));
    console.log(`Playable after ${attempts.length} ${attempts.length === 1 ? "try" : "tries"} (${seconds} s, $${(spent() - costBefore).toFixed(4)})\n`);
    if (design.note) console.log(`Designer's note: ${design.note}\n`);
    describe(room);
    console.log(`\nSaved to ${saveLevel(room)}`);
  } catch (error) {
    if (!(error instanceof DesignError)) throw error;
    printFixes(error.attempts);
    console.log(`No playable level after ${error.attempts.length} tries.`);
  }
}

const usage = designer.usage();
if (usage) console.log(`\nTotal: ${usage.calls} calls, $${usage.usd.toFixed(4)}`);

function printFixes(attempts: string[][]): void {
  for (const [index, problems] of attempts.entries()) {
    console.log(`Try ${index + 1} had ${problems.length} problem${problems.length === 1 ? "" : "s"}, sent back to the designer:`);
    for (const problem of problems) console.log(`  - ${problem}`);
  }
}

function describe(room: Room): void {
  const thief = room.agents.find((agent) => agent.role === "thief")!;
  const target = room.objects.find((object) => object.id === room.targetId)!;
  console.log(`${room.name}  (style: ${room.layout?.style}, ${room.maxSteps} steps)`);
  console.log(room.story);
  console.log("");
  for (const line of sketch(room)) console.log(`  ${line}`);
  console.log("");
  for (const zone of room.zones) {
    const tags = [zone.id === thief.zone ? "you start here" : "", zone.exitName ? `exit: ${zone.exitName}` : ""].filter(Boolean);
    console.log(`${zone.name}${tags.length ? `  [${tags.join(", ")}]` : ""}`);
    const things = room.objects.filter((object) => object.zone === zone.id).map(describeObject);
    if (things.length) console.log(`    ${things.join(", ")}`);
    for (const hunter of room.agents.filter((agent) => agent.role === "guard" && agent.zone === zone.id)) {
      const duty = hunter.duty === "patrol" ? `patrols ${hunter.route?.join(" → ")}` : hunter.duty === "target" ? "guards the target" : "watches an exit";
      console.log(`    ${hunter.name} (${hunter.look}, ${duty})`);
    }
  }
  const held = room.objects.filter((object) => object.heldBy === thief.id).map((object) => object.name);
  if (held.length) console.log(`You carry: ${held.join(", ")}`);
  console.log(`Target: the ${target.name}`);
  console.log(`Doors: ${room.layout?.doors.map((door) => `${door.from}–${door.to} (${door.kind})`).join(", ")}`);
  console.log("Facts:");
  for (const fact of room.facts) console.log(`  - ${fact.text}${fact.forbids ? ` [rules out: ${fact.forbids}]` : ""}`);
}

function describeObject(object: Room["objects"][number]): string {
  const tags = [
    object.hideCapacity ? "hide" : "",
    object.lightSource ? `light for ${object.lights?.join(", ")}` : "",
    object.portable ? "carry" : "",
    object.breakable ? "breaks" : "",
  ].filter(Boolean);
  return `${object.name}${tags.length ? ` (${tags.join(", ")})` : ""}`;
}

/** A plan of the building in text: one box per room, with the walls between rooms. */
function sketch(room: Room): string[] {
  const areas = room.layout?.areas ?? [];
  const left = Math.min(...areas.map((area) => area.col));
  const top = Math.min(...areas.map((area) => area.row));
  const columns = Math.max(...areas.map((area) => area.col + area.width));
  const rows = Math.max(...areas.map((area) => area.row + area.depth));
  const at = (col: number, row: number) =>
    areas.find((area) => col >= area.col && col < area.col + area.width && row >= area.row && row < area.row + area.depth);
  const name = (zone: string) => (room.zones.find((z) => z.id === zone)?.name ?? zone).replace(/^the /, "");
  const width = 18;
  const lines: string[] = [];
  for (let row = top; row <= rows; row++) {
    let border = "";
    for (let col = left; col < columns; col++) border += `+${row === top || row === rows || at(col, row - 1) !== at(col, row) ? "-".repeat(width) : " ".repeat(width)}`;
    lines.push(`${border}+`);
    if (row === rows) break;
    let label = "";
    for (let col = left; col < columns; col++) {
      const area = at(col, row);
      const wall = col === left || at(col - 1, row) !== area ? "|" : " ";
      const text = area && area.col === col && area.row === row ? ` ${name(area.zone)}` : "";
      label += wall + text.slice(0, width).padEnd(width);
    }
    lines.push(`${label}|`);
  }
  return lines;
}
