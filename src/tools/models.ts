// Builds public/models/manifest.json: every 3D model in public/models/<pack>/, with its size, so the
// game kit can place it and the writer knows what exists. Run after adding a model pack:
//   npm run models      (the server must be running; a hidden Edge measures the models)
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, ROOT } from "../config.ts";
import { Browser, sleep } from "../make/browser.ts";

const DIR = join(ROOT, "public", "models");
const files = readdirSync(DIR)
  .filter((pack) => statSync(join(DIR, pack)).isDirectory())
  .flatMap((pack) => readdirSync(join(DIR, pack)).filter((file) => /\.(glb|gltf)$/.test(file)).map((file) => `${pack}/${file}`));
writeFileSync(join(DIR, "index.json"), JSON.stringify(files));
console.log(`Measuring ${files.length} models…`);

const browser = await Browser.open();
try {
  await browser.goto(`http://localhost:${config.port}/models/measure.html`);
  let line: string | undefined;
  for (let waited = 0; waited < 120_000 && !line; waited += 500) {
    await sleep(500);
    line = browser.console.find((entry) => entry.startsWith("MODELS "));
  }
  for (const skipped of browser.console.filter((entry) => entry.startsWith("SKIPPED"))) console.log(skipped);
  if (!line) throw new Error("The measuring page did not finish");
  const sizes = JSON.parse(line.slice("MODELS ".length)) as Record<string, { size: number[]; min: number[] }>;
  // Named without the extension; a readable label from the file name: "racing/grandStandCovered" → "grand stand covered".
  const manifest = Object.fromEntries(
    Object.entries(sizes).map(([file, info]) => {
      const name = file.replace(/\.(glb|gltf)$/, "");
      const label = name.split("/")[1].replace(/_exclusive$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
      return [name, { ...info, file, label }];
    }),
  );
  writeFileSync(join(DIR, "manifest.json"), JSON.stringify(manifest, null, 1));
  console.log(`Saved ${Object.keys(manifest).length} models to public/models/manifest.json`);
} finally {
  await browser.close();
}
