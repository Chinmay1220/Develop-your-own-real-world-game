// Converts realistic people from Microsoft Rocketbox (MIT, github.com/microsoft/Microsoft-Rocketbox)
// into public/models/people/: one small GLB per person, the shared male and female animations, and
// index.json. A hidden Edge runs the converter page (public/lab/rocketbox.html), so the server must
// be running. Run with: npm run people  (downloads about 1.5 GB of source files; takes a few minutes)
// npm run people -- Police_Male_01 Chef_Female_01  converts only those, keeping everyone else.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, ROOT } from "../config.ts";
import { Browser, sleep } from "../make/browser.ts";

/** Who to convert: their folder in Rocketbox's Assets, and how the game writer will know them. */
export const PEOPLE: Record<string, { folder: string; description: string }> = {
  Police_Male_01: { folder: "Avatars/Professions", description: "police officer, man" },
  Police_Female_01: { folder: "Avatars/Professions", description: "police officer, woman" },
  Security_Male_01: { folder: "Avatars/Professions", description: "security guard, man" },
  Security_Female_01: { folder: "Avatars/Professions", description: "security guard, woman" },
  Military_Male_01: { folder: "Avatars/Professions", description: "soldier in uniform, man" },
  Military_Female_01: { folder: "Avatars/Professions", description: "soldier in uniform, woman" },
  Business_Male_01: { folder: "Avatars/Professions", description: "businessman in a suit" },
  Business_Female_01: { folder: "Avatars/Professions", description: "businesswoman" },
  Medical_Male_01: { folder: "Avatars/Professions", description: "doctor, man" },
  Medical_Female_01: { folder: "Avatars/Professions", description: "nurse or doctor, woman" },
  Fire_Male_01: { folder: "Avatars/Professions", description: "firefighter" },
  Construction_Male_01: { folder: "Avatars/Professions", description: "construction worker" },
  Pilot_Male_01: { folder: "Avatars/Professions", description: "airline pilot" },
  Chef_Female_01: { folder: "Avatars/Professions", description: "chef" },
  Sports_Male_02: { folder: "Avatars/Professions", description: "football player in a black and white striped kit" },
  Sports_Female_02: { folder: "Avatars/Professions", description: "woman in sportswear (tank top and track trousers)" },
  Delivery_Male_01: { folder: "Avatars/Professions", description: "delivery driver" },
  Gardener_Male_01: { folder: "Avatars/Professions", description: "gardener" },
  Male_Adult_08: { folder: "Avatars/Adults", description: "young man in a light blue shirt" },
  Male_Adult_12: { folder: "Avatars/Adults", description: "young man in a denim jacket and jeans" },
  Male_Adult_03: { folder: "Avatars/Adults", description: "older grey-haired man in a tweed jacket" },
  Female_Adult_05: { folder: "Avatars/Adults", description: "young woman in a pink blazer and jeans" },
  Female_Adult_14: { folder: "Avatars/Adults", description: "woman in a beige jacket and jeans" },
  Female_Adult_10: { folder: "Avatars/Adults", description: "woman in a black abaya and headscarf" },
  Male_Child_01: { folder: "Avatars/Children", description: "boy" },
  Female_Child_01: { folder: "Avatars/Children", description: "girl" },
};
// The skeleton each gender's shared animations are exported on.
const ANIMATION_SOURCES = { m: "Avatars/Adults/Male_Adult_08", f: "Avatars/Adults/Female_Adult_05" };

const OUT = join(ROOT, "public", "models", "people");
const genderOf = (name: string) => (/female/i.test(name) ? "f" : "m");

interface Report {
  name: string;
  gender: string;
  height: number;
  rootHeight: number;
  mb: number;
  speeds?: Record<string, number>;
  clips?: string[];
}

async function main() {
  const tree = (await (await fetch("https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/master?recursive=1", { headers: { "User-Agent": "people converter" } })).json()) as { tree: { path: string; type: string }[] };
  const texturesOf = (path: string) => tree.tree.filter((entry) => entry.type === "blob" && entry.path.startsWith(`Assets/${path}/Textures/`)).map((entry) => entry.path.split("/").pop());
  mkdirSync(OUT, { recursive: true });
  const browser = await Browser.open({ width: 700, height: 700 });

  async function convert(query: Record<string, string>, file: string): Promise<Report> {
    browser.console.length = 0;
    await browser.goto(`http://localhost:${config.port}/lab/rocketbox.html?${new URLSearchParams(query)}`);
    for (let waited = 0; waited < 300_000 && !browser.console.some((line) => /^LOG (DONE|FAIL)/.test(line) || line.startsWith("PAGE ERROR")); waited += 500) await sleep(500);
    const failure = browser.console.find((line) => /^LOG FAIL/.test(line) || line.startsWith("PAGE ERROR"));
    if (failure) throw new Error(failure);
    const evaluate = async (expression: string) => (await browser.send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;
    writeFileSync(join(OUT, file), Buffer.from((await evaluate("window.result")) as string, "base64"));
    return (await evaluate("window.report")) as Report;
  }

  const only = process.argv.slice(2);
  const index = join(OUT, "index.json");
  const before = existsSync(index) ? (JSON.parse(readFileSync(index, "utf8")) as { animations: Record<string, unknown>; people: Record<string, unknown> }) : null;
  try {
    const animations: Record<string, unknown> = only.length && before ? before.animations : {};
    if (!only.length || !before) {
      for (const [gender, path] of Object.entries(ANIMATION_SOURCES)) {
        const report = await convert({ mode: "animations", path, gender, textures: "" }, `animations-${gender}.glb`);
        animations[gender] = { file: `animations-${gender}.glb`, rootHeight: report.rootHeight, speeds: report.speeds, clips: report.clips };
        console.log(`animations (${gender}): ${report.clips?.join(", ")}; walk ${report.speeds?.walk} m/s, run ${report.speeds?.run} m/s; ${report.mb} MB`);
      }
    }
    // Everyone still on the list keeps their earlier conversion unless named again.
    const people: Record<string, unknown> = Object.fromEntries(Object.entries(before?.people ?? {}).filter(([name]) => PEOPLE[name] && only.length));
    for (const [name, { folder, description }] of Object.entries(PEOPLE).filter(([name]) => !only.length || only.includes(name))) {
      try {
        const report = await convert({ mode: "avatar", path: `${folder}/${name}`, textures: texturesOf(`${folder}/${name}`).join(",") }, `${name}.glb`);
        people[name] = { description, gender: genderOf(name), height: report.height, rootHeight: report.rootHeight, file: `${name}.glb` };
        console.log(`${name}: ${description}, ${report.height} m tall, ${report.mb} MB`);
      } catch (error) {
        console.log(`${name} failed: ${(error as Error).message.slice(0, 300)}`);
      }
    }
    const ordered = Object.fromEntries(Object.keys(PEOPLE).filter((name) => people[name]).map((name) => [name, people[name]]));
    writeFileSync(index, JSON.stringify({ source: "Microsoft Rocketbox (github.com/microsoft/Microsoft-Rocketbox), MIT licence", animations, people: ordered }, null, 2));
    writeFileSync(
      join(OUT, "LICENSE.txt"),
      "These people and animations are converted from the Microsoft Rocketbox avatar library\n(https://github.com/microsoft/Microsoft-Rocketbox), released by Microsoft under the MIT License.\nTextures were shrunk and the files repacked as GLB for the web; nothing else was changed.\n\nMIT License, Copyright (c) Microsoft Corporation.\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated\ndocumentation files, to deal in the Software without restriction, including the rights to use, copy, modify, merge,\npublish, distribute, sublicense, and/or sell copies, subject to including this notice. The software is provided\n\"as is\", without warranty of any kind.\n",
    );
    console.log(`Wrote ${Object.keys(people).length} people to ${OUT}`);
  } finally {
    await browser.close();
  }
}

if (import.meta.main) await main();
