// A small local web server: serves the browser game from public/ and a JSON API for it.
// Run with: npm start, then open http://localhost:3000
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { createAi, createDesigner, createListener } from "./ai/index.ts";
import { config, ROOT } from "./config.ts";
import { CATALOG } from "./design/catalog.ts";
import { DesignError, designLevel } from "./design/designer.ts";
import { listLevels, loadLevel, saveLevel } from "./design/levels.ts";
import { loadRoom } from "./game/room.ts";
import { createLive } from "./live/live.ts";
import { createNoEngine, EngineError, publicWorld } from "./paint/engine.ts";
import { createRewind, publicCase, RewindError } from "./rewind/engine.ts";
import { readCall } from "./live/rules.ts";
import { listGames, loadGame } from "./make/games.ts";
import { makeGame } from "./make/maker.ts";
import { createReviewer } from "./make/reviewer.ts";
import { testGame } from "./make/tester.ts";
import { createWriter } from "./make/writer.ts";
import { Session, type PlayerAction } from "./game/session.ts";
import type { ActionKind } from "./game/types.ts";
import { loadNotebook } from "./memory/notebook.ts";
import { buildView } from "./view.ts";
import { readWav } from "./voice.ts";

const room = loadRoom(resolve(ROOT, config.roomFile));
const notebookPath = join(ROOT, "data", "notebooks", `${room.id}.json`);
const session = new Session(room, createAi(), loadNotebook(notebookPath), { notebookPath, logDir: join(ROOT, "data", "logs") });
const designer = createDesigner();
const listener = createListener();
const writer = createWriter();
const reviewer = createReviewer();
const live = createLive();
const noEngine = createNoEngine();
const rewind = createRewind();
let designing = false;
let making = false;
const MAX_SPEECH_SECONDS = 60;

const PUBLIC_DIR = join(ROOT, "public");
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".jpg": "image/jpeg",
  ".hdr": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
};
const PLAYER_ACTIONS = new Set<ActionKind>(["move", "take", "drop", "hide", "unhide", "throw", "use", "search", "wait", "free"]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) await handleApi(request, response, url.pathname);
    else await serveFile(response, url.pathname);
  } catch (error) {
    send(response, 500, { error: (error as Error).message });
  }
});

async function handleApi(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  if (request.method === "GET" && path === "/api/state") return send(response, 200, buildView(session));
  if (request.method === "GET" && path === "/api/levels") return send(response, 200, listLevels());
  if (request.method === "GET" && path === "/api/catalog") return send(response, 200, CATALOG);
  if (request.method === "GET" && path.startsWith("/api/levels/")) {
    const level = loadLevel(path.slice("/api/levels/".length));
    return level ? send(response, 200, level) : send(response, 404, { error: "No such level" });
  }
  if (request.method === "GET" && path === "/api/games") return send(response, 200, listGames());
  if (request.method === "GET" && path.startsWith("/api/games/")) {
    const game = loadGame(path.slice("/api/games/".length));
    return game ? send(response, 200, game) : send(response, 404, { error: "No such game" });
  }
  if (request.method === "GET" && path.startsWith("/api/paint/")) return paintedFile(response, path.slice("/api/paint/".length));
  if (request.method === "GET" && path.startsWith("/api/rewind/")) return rewindFile(response, path.slice("/api/rewind/".length));
  if (request.method === "GET" && path.startsWith("/api/live/")) {
    const id = path.slice("/api/live/".length);
    return loadGame(id) ? send(response, 200, live.lessons(id)) : send(response, 404, { error: "No such game" });
  }
  if (request.method !== "POST") return send(response, 405, { error: "Use POST" });

  // The endpoints that cost money need a content type a page can't send without asking first,
  // so a game running in the sealed frame can't call them. Its questions for Meta's AI go
  // through the page around it (sandbox.js), which limits how many it asks at once.
  const type = request.headers["content-type"] ?? "";
  const paid = {
    "/api/design": "application/json",
    "/api/make": "application/json",
    "/api/transcribe": "audio/wav",
    "/api/live": "application/json",
    "/api/live/forget": "application/json",
    "/api/paint/start": "application/json",
    "/api/paint/act": "application/json",
    "/api/paint/again": "application/json",
    "/api/rewind/start": "application/json",
    "/api/rewind/paint": "application/json",
  }[path];
  if (paid && !type.startsWith(paid)) return send(response, 415, { error: `Send ${paid}` });
  if (path === "/api/design") return design(request, response);
  if (path === "/api/make") return make(request, response);
  if (path === "/api/transcribe") return transcribe(request, response);
  if (path === "/api/live") return askLive(request, response);
  if (path.startsWith("/api/paint/")) return paint(request, response, path.slice("/api/paint/".length));
  if (path.startsWith("/api/rewind/")) return rewindCase(request, response, path.slice("/api/rewind/".length));
  if (path === "/api/live/forget") {
    const body = (await readJson(request)) as { game?: unknown } | null;
    if (typeof body?.game !== "string" || !loadGame(body.game)) return send(response, 404, { error: "No such game" });
    live.forget(body.game);
    return send(response, 200, live.lessons(body.game));
  }

  if (path === "/api/action") {
    const action = toPlayerAction(await readJson(request));
    if (!action) return send(response, 400, { error: "Send an action such as {\"kind\": \"move\", \"target\": \"desk\"}" });
    try {
      await session.act(action);
    } catch (error) {
      return send(response, 409, { error: (error as Error).message });
    }
    return send(response, 200, buildView(session));
  }
  if (path === "/api/round") {
    session.startRound();
    return send(response, 200, buildView(session));
  }
  if (path === "/api/reset") {
    session.resetMemory();
    return send(response, 200, buildView(session));
  }
  send(response, 404, { error: "Unknown endpoint" });
}

/** Designs a level from the player's words. One at a time, because each costs money and takes about half a minute. */
async function design(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = (await readJson(request)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 500) : "";
  if (!prompt) return send(response, 400, { error: 'Send {"prompt": "describe the game you want"}' });
  if (designing) return send(response, 409, { error: "Already designing a level. Try again in a moment." });
  designing = true;
  const costBefore = designer.usage()?.usd ?? 0;
  try {
    const { room: level, design: plan, attempts } = await designLevel(prompt, designer);
    saveLevel(level);
    for (const [index, problems] of attempts.slice(0, -1).entries()) console.log(`Design try ${index + 1} sent back to fix: ${problems.join("; ")}`);
    send(response, 200, { id: level.id, note: plan.note, tries: attempts.length, usd: (designer.usage()?.usd ?? 0) - costBefore });
  } catch (error) {
    if (error instanceof DesignError) return send(response, 422, { error: error.message });
    throw error;
  } finally {
    designing = false;
  }
}

/** Makes a whole game from the player's words: write, test in a hidden browser, fix. Takes minutes. */
async function make(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = (await readJson(request)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 4000) : ""; // room for a detailed brief
  if (!prompt) return send(response, 400, { error: 'Send {"prompt": "describe the game you want"}' });
  if (!writer) return send(response, 503, { error: "Making games needs a Meta API key in .env." });
  if (making) return send(response, 409, { error: "Already making a game. Try again when it's done." });
  making = true;
  const spent = () => (writer.usage()?.usd ?? 0) + (reviewer?.usage()?.usd ?? 0);
  const costBefore = spent();
  try {
    const result = await makeGame(prompt, writer, (id) => testGame(id, config.port), { log: (line) => console.log(`[make] ${line}`), reviewer });
    send(response, 200, { id: result.game.id, title: result.game.title, tries: result.attempts.length, problems: result.attempts.at(-1), usd: spent() - costBefore });
  } finally {
    making = false;
  }
}

/** Turns a spoken idea (a WAV clip from the page) into words with Meta's speech-to-text model. */
async function transcribe(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!listener) return send(response, 503, { error: "Voice input needs a Meta API key in .env." });
  const audio = await readBytes(request, 64_000 + MAX_SPEECH_SECONDS * 24_000 * 2);
  if (!audio) return send(response, 413, { error: `Keep it under ${MAX_SPEECH_SECONDS} seconds.` });
  const clip = readWav(audio);
  if (typeof clip === "string") return send(response, 400, { error: clip });
  if (clip.seconds > MAX_SPEECH_SECONDS) return send(response, 413, { error: `Keep it under ${MAX_SPEECH_SECONDS} seconds.` });
  const costBefore = listener.usage()?.usd ?? 0;
  const { text, seconds } = await listener.transcribe(audio);
  send(response, 200, { text, seconds, usd: (listener.usage()?.usd ?? 0) - costBefore });
}

/** Rewind: investigate a photo of an aftermath, or paint another explanation's moments. */
async function rewindCase(request: IncomingMessage, response: ServerResponse, what: string): Promise<void> {
  if (!rewind) return send(response, 503, { error: "Rewind needs a Meta API key in .env." });
  try {
    if (what === "start") {
      const body = ((await readJson(request, 12_000_000)) ?? {}) as { photo?: unknown; context?: unknown };
      const photo = typeof body.photo === "string" ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(body.photo)?.[1] : undefined;
      if (!photo) return send(response, 400, { error: "Send the photo as a JPEG data URL." });
      const context = typeof body.context === "string" ? body.context.trim().slice(0, 600) : "";
      return send(response, 200, publicCase(await rewind.start(Buffer.from(photo, "base64"), context)));
    }
    if (what === "paint") {
      const body = ((await readJson(request)) ?? {}) as { id?: unknown; hypothesis?: unknown };
      return send(response, 200, publicCase(rewind.paint(String(body.id ?? ""), Number(body.hypothesis))));
    }
  } catch (error) {
    if (error instanceof RewindError) return send(response, error.status, { error: error.message });
    throw error;
  }
  send(response, 404, { error: "Unknown endpoint" });
}

/** A case (GET /api/rewind/<id>), its photo (<id>/photo.jpg) or a painted moment (<id>/<h>-<n>.jpg), which waits while it paints. */
async function rewindFile(response: ServerResponse, rest: string): Promise<void> {
  if (!rewind) return send(response, 503, { error: "Rewind needs a Meta API key in .env." });
  const [id, file] = rest.split("/");
  if (!file) {
    const record = rewind.get(id);
    return record ? send(response, 200, publicCase(record)) : send(response, 404, { error: "No such case" });
  }
  const moment = /^(\d)-(\d)\.jpg$/.exec(file);
  const jpeg = file === "photo.jpg" ? rewind.photo(id) : moment ? await rewind.frame(id, Number(moment[1]), Number(moment[2])) : null;
  if (!jpeg) return send(response, 404, { error: "No such picture" });
  response.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" });
  response.end(jpeg);
}

/** No Engine: start a painted world from the player's words, make a move, or play the next round. */
async function paint(request: IncomingMessage, response: ServerResponse, what: string): Promise<void> {
  if (!noEngine) return send(response, 503, { error: "No Engine needs a Meta API key in .env." });
  const body = ((await readJson(request)) ?? {}) as { prompt?: unknown; id?: unknown; text?: unknown };
  const words = (value: unknown, limit: number) => (typeof value === "string" ? value.trim().slice(0, limit) : "");
  try {
    if (what === "start") {
      const prompt = words(body.prompt, 1000);
      if (!prompt) return send(response, 400, { error: 'Send {"prompt": "describe the world you want to play"}' });
      return send(response, 200, publicWorld(await noEngine.start(prompt)));
    }
    if (what === "act") {
      const text = words(body.text, 300);
      if (!text) return send(response, 400, { error: "Say what you do." });
      return send(response, 200, publicWorld(await noEngine.act(words(body.id, 80), text)));
    }
    if (what === "again") return send(response, 200, publicWorld(await noEngine.again(words(body.id, 80))));
  } catch (error) {
    if (error instanceof EngineError) return send(response, error.status, { error: error.message });
    throw error;
  }
  send(response, 404, { error: "Unknown endpoint" });
}

/** A painted world (GET /api/paint/<id>) or one of its frames (GET /api/paint/<id>/<n>.jpg), which waits while it paints. */
async function paintedFile(response: ServerResponse, rest: string): Promise<void> {
  if (!noEngine) return send(response, 503, { error: "No Engine needs a Meta API key in .env." });
  const [id, frame] = rest.split("/");
  if (!frame) {
    const world = noEngine.get(id);
    return world ? send(response, 200, publicWorld(world)) : send(response, 404, { error: "No such world" });
  }
  const n = /^(\d{1,3})\.jpg$/.exec(frame)?.[1];
  const jpeg = n ? await noEngine.frame(id, Number(n)) : null;
  if (!jpeg) return send(response, 404, { error: "No such frame" });
  response.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" });
  response.end(jpeg);
}

/** A running game asks Meta's AI what happens, what a character does, or what to learn from a round. */
async function askLive(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const call = readCall(await readJson(request, 60_000));
  if (typeof call === "string") return send(response, 400, { error: call });
  if (!loadGame(call.game)) return send(response, 404, { error: "No such game" });
  const reply = await live.handle(call);
  send(response, reply.status, reply.body);
}

/** The raw request body, or null if it is bigger than the limit. */
async function readBytes(request: IncomingMessage, limit: number): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Keeps only the fields a player may send. */
function toPlayerAction(body: unknown): PlayerAction | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  if (typeof raw.kind !== "string" || !PLAYER_ACTIONS.has(raw.kind as ActionKind)) return null;
  const field = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).slice(0, 200) : undefined);
  if (raw.kind === "free" && !field("text")?.trim()) return null;
  return { kind: raw.kind as ActionKind, target: field("target"), item: field("item"), text: field("text") };
}

async function readJson(request: IncomingMessage, limit = 10_000): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > limit) throw new Error("Request too large");
  }
  try {
    return JSON.parse(body || "null");
  } catch {
    return null;
  }
}

async function serveFile(response: ServerResponse, pathname: string): Promise<void> {
  const file = resolve(PUBLIC_DIR, `.${pathname === "/" ? "/index.html" : decodeURIComponent(pathname)}`);
  const type = CONTENT_TYPES[extname(file)];
  if (!file.startsWith(PUBLIC_DIR + sep) || !type) return send(response, 404, { error: "Not found" });
  try {
    const content = await readFile(file);
    // Games run in a sealed frame with no origin of their own; this lets them load the kit's files.
    // Models, the sky and textures are big and never change, so browsers may keep them for a day.
    const cache = /^\/(assets|models)\//.test(pathname) ? "public, max-age=86400" : "no-store";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": cache, "Access-Control-Allow-Origin": "*" });
    response.end(content);
  } catch {
    send(response, 404, { error: "Not found" });
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

server.listen(config.port, "127.0.0.1", () => {
  const models = session.ai.mode === "meta" ? `Meta Model API (${Object.values(session.ai.models).join(", ")})` : "offline stand-in models (no API key set)";
  console.log(`Home Heist is running at http://localhost:${config.port}`);
  console.log(`Room: ${room.name}. AI: ${models}.`);
  console.log(`Level designer (${designer.model}): http://localhost:${config.port}/levels.html`);
  console.log(listener ? `Voice input: ${listener.model}` : "Voice input: off (needs MODEL_API_KEY)");
  console.log(writer ? `Game maker (${writer.model}): http://localhost:${config.port}/make.html` : "Game maker: off (needs MODEL_API_KEY)");
  const ai = live.ai?.models;
  console.log(ai ? `AI inside games: world ${ai.act}, minds ${ai.think}, learning ${ai.learn}, up to $${config.liveBudgetUsd.toFixed(2)} per run` : "AI inside games: off (needs MODEL_API_KEY)");
  console.log(
    noEngine
      ? `No Engine (${config.models.engine} decides, ${config.models.painter} paints, up to $${config.paintBudgetUsd.toFixed(2)} per run): http://localhost:${config.port}/paint.html`
      : "No Engine: off (needs MODEL_API_KEY)",
  );
  console.log(rewind ? `Rewind (${config.models.teacher} investigates, ${config.models.painter} paints the moments before): http://localhost:${config.port}/rewind.html` : "Rewind: off (needs MODEL_API_KEY)");
});
