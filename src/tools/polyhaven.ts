// Builds public/models/polyhaven.json: every Poly Haven model (CC0, polyhaven.com) light enough for a
// browser game, with its real size and file links, plus Poly Haven's surfaces and photographed skies.
// Games load the files straight from Poly Haven's servers, so nothing big is stored here.
// Run with: npm run polyhaven  (about 1,800 small requests; a few minutes)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../config.ts";

const API = "https://api.polyhaven.com";
export const FILES = "https://dl.polyhaven.org/file/ph-assets/";
const MAX_POLYGONS = 150_000; // heavier models are made for films, not games
const MAX_MB = 15;
const HEADERS = { "User-Agent": "develop-your-own-real-world-game asset index" };

interface AssetInfo {
  name: string;
  categories?: string[];
  polycount?: number;
}
interface FileLink {
  url: string;
  size: number;
  include?: Record<string, { url: string; size: number }>;
}

async function get<T>(url: string, attempt = 1): Promise<T> {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) {
    if (attempt < 4) {
      await new Promise((done) => setTimeout(done, 800 * attempt));
      return get(url, attempt + 1);
    }
    throw new Error(`${response.status} for ${url}`);
  }
  return (await response.json()) as T;
}

/** Runs fn over items, a few at a time. */
async function each<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

const short = (url: string) => (url.startsWith(FILES) ? url.slice(FILES.length) : url);
const categoriesOf = (info: AssetInfo) => (info.categories ?? []).filter((category) => !category.startsWith("collection"));

// ---------------------------------------------------------------------------------------------
// A model's size from its glTF file alone: the min and max of every mesh's positions, moved by the
// node transforms. Only the most detailed level (LOD0) counts.

type Mat4 = number[]; // column-major, like glTF

function compose(node: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): Mat4 {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  return out;
}

const apply = (m: Mat4, [x, y, z]: number[]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

interface Gltf {
  scene?: number;
  scenes?: { nodes: number[] }[];
  nodes: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes: { primitives: { attributes: { POSITION?: number } }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
}

export function modelBounds(gltf: Gltf): { min: number[]; max: number[] } | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (index: number, parent: Mat4) => {
    const node = gltf.nodes[index];
    if (/_LOD[1-9]/.test(node.name ?? "")) return;
    const world = multiply(parent, compose(node));
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION ?? -1];
        if (!accessor?.min || !accessor.max) continue;
        for (const cx of [accessor.min[0], accessor.max[0]])
          for (const cy of [accessor.min[1], accessor.max[1]])
            for (const cz of [accessor.min[2], accessor.max[2]]) {
              const point = apply(world, [cx, cy, cz]);
              for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], point[i])), (max[i] = Math.max(max[i], point[i]));
            }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []) visit(root, identity);
  return Number.isFinite(min[0]) ? { min, max } : null;
}

// ---------------------------------------------------------------------------------------------

export interface IndexedModel {
  name: string;
  categories: string[];
  polygons: number;
  mb: number; // download size with 1k textures
  size: number[]; // width × height × depth in metres
  min: number[]; // the corner of its box, so the kit can stand it on its base
  gltf: string; // relative to FILES
  files: Record<string, string>; // the paths the glTF asks for → where they really are
}

async function main() {
  const rounded = (values: number[]) => values.map((value) => Math.round(value * 1000) / 1000);
  const models: Record<string, IndexedModel> = {};
  const all = await get<Record<string, AssetInfo>>(`${API}/assets?t=models`);
  const light = Object.entries(all).filter(([, info]) => info.polycount && info.polycount <= MAX_POLYGONS);
  console.log(`${light.length} of ${Object.keys(all).length} models have at most ${MAX_POLYGONS} polygons`);
  let done = 0;
  await each(light, 8, async ([id, info]) => {
    try {
      const files = await get<{ gltf?: Record<string, { gltf: FileLink }> }>(`${API}/files/${id}`);
      const link = files.gltf?.["1k"]?.gltf;
      if (!link) return;
      const mb = (link.size + Object.values(link.include ?? {}).reduce((sum, file) => sum + file.size, 0)) / 1e6;
      if (mb > MAX_MB) return;
      const box = modelBounds(await get<Gltf>(link.url));
      if (!box) return;
      models[id] = {
        name: info.name,
        categories: categoriesOf(info),
        polygons: info.polycount!,
        mb: Math.round(mb * 10) / 10,
        size: rounded(box.max.map((value, i) => value - box.min[i])),
        min: rounded(box.min),
        gltf: short(link.url),
        files: Object.fromEntries(Object.entries(link.include ?? {}).map(([path, file]) => [path, short(file.url)])),
      };
    } catch (error) {
      console.log(`  skipped ${id}: ${(error as Error).message}`);
    } finally {
      if (++done % 50 === 0) console.log(`  models: ${done}/${light.length}`);
    }
  });

  // Surfaces: colour, bump (OpenGL normal) and roughness maps at 1k.
  const textures: Record<string, { name: string; categories: string[]; map: string; normal: string | null; rough: string | null }> = {};
  const allTextures = await get<Record<string, AssetInfo>>(`${API}/assets?t=textures`);
  done = 0;
  await each(Object.entries(allTextures), 8, async ([id, info]) => {
    try {
      const files = await get<Record<string, Record<string, Record<string, FileLink>>>>(`${API}/files/${id}`);
      const pick = (...names: string[]) => names.map((name) => files[name]?.["1k"]?.jpg?.url).find(Boolean);
      const map = pick("Diffuse", "diff", "Color");
      if (!map) return;
      textures[id] = { name: info.name, categories: categoriesOf(info), map: short(map), normal: short(pick("nor_gl", "Normal") ?? "") || null, rough: short(pick("Rough", "rough") ?? "") || null };
    } catch (error) {
      console.log(`  skipped texture ${id}: ${(error as Error).message}`);
    } finally {
      if (++done % 100 === 0) console.log(`  surfaces: ${done}/${Object.keys(allTextures).length}`);
    }
  });

  // Skies: the photographed 360° skies (HDRIs). Their files follow one pattern, so only names are kept.
  const allSkies = await get<Record<string, AssetInfo>>(`${API}/assets?t=hdris`);
  const skies = Object.fromEntries(Object.entries(allSkies).map(([id, info]) => [id, { name: info.name, categories: categoriesOf(info) }]));

  const out = join(ROOT, "public", "models", "polyhaven.json");
  const sorted = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(out, JSON.stringify({ source: "Poly Haven (polyhaven.com), CC0", files: FILES, sky: "HDRIs/hdr/1k/<id>_1k.hdr", models: sorted(models), surfaces: sorted(textures), skies: sorted(skies) }));
  console.log(`Wrote ${out}: ${Object.keys(models).length} models, ${Object.keys(textures).length} surfaces, ${Object.keys(skies).length} skies`);
}

if (import.meta.main) await main();
