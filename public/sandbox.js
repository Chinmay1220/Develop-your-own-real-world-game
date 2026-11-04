// Runs a game the AI wrote inside a sealed iframe. The game can't reach this page, the server's API
// or your files: it may only load the game kit (from this server) and three.js (from jsDelivr).
// It reports "ready", "win", "lose" and errors back through postMessage. When it asks Meta's AI
// something (the world model, a character's mind, or learning after a round), this page passes the
// question to the server for it, a few at a time, and sends the answer back into the frame.

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/";
const MAX_ASKING = 3;

/** JSON that is safe inside a <script> tag. */
const inline = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

let models = null;

/** One line about a question and its answer, for logs and the page. */
function summarize(call, result, error) {
  const changes = (result?.changes ?? []).map(({ name, input }) => `${name}(${Object.values(input).join(", ")})`).join(", ");
  const answer = error ? `failed: ${error}` : call.kind === "act" ? `${result.story}${changes ? ` [${changes}]` : ""}` : call.kind === "think" ? `${result.thought}${result.say ? ` “${result.say}”` : ""}${changes ? ` [${changes}]` : ""}` : result.summary;
  const question = call.kind === "act" ? `${call.by === "game" ? "game asks" : "player tries"}: ${call.text}` : call.kind === "think" ? `${call.name} thinks${call.event ? ` about: ${call.event}` : ""}` : `learning from a ${call.result}`;
  return `${question} → ${answer}`;
}

/**
 * Plays a game in a sealed frame. options.listen, if given, records the player's voice and returns
 * { text }; the frame can't use the microphone itself.
 */
export async function runGame(container, game, catalog, onMessage = () => {}, options = {}) {
  models ??= await (await fetch("/models/manifest.json")).json();
  const origin = location.origin;
  const policy = [
    "default-src 'none'",
    `script-src 'unsafe-inline' blob: ${origin} https://cdn.jsdelivr.net`,
    // Models, skies and textures only (ours, and Poly Haven's CC0 library): never the API.
    `connect-src https://cdn.jsdelivr.net https://dl.polyhaven.org ${origin}/models/ ${origin}/assets/`,
    `img-src data: blob: https://cdn.jsdelivr.net https://dl.polyhaven.org ${origin}/models/ ${origin}/assets/`,
    "style-src 'unsafe-inline'",
    "media-src data: blob:",
  ].join("; ");
  const page = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<script type="importmap">${inline({ imports: { three: `${THREE_URL}build/three.module.js`, "three/addons/": `${THREE_URL}examples/jsm/`, kit: `${origin}/kit/kit.js` } })}</script>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#05070b}</style>
<script>
  const send = (message) => parent.postMessage({ source: "kit", ...message }, "*");
  addEventListener("error", (event) => send({ kind: "error", message: String(event.message) + (event.error && event.error.stack ? "\\n" + event.error.stack : "") }));
  addEventListener("unhandledrejection", (event) => send({ kind: "error", message: "Unhandled: " + (event.reason && (event.reason.stack || event.reason)) }));
</script>
</head><body>
<script type="module">
  import { startKit } from "kit";
  const kit = await startKit({ catalog: ${inline(catalog)}, models: ${inline(models)} });
  const url = URL.createObjectURL(new Blob([${inline(game.code)}], { type: "text/javascript" }));
  const module = await import(url);
  if (typeof module.default !== "function") throw new Error("The game module has no default export function main(kit)");
  await module.default(kit);
</script>
</body></html>`;

  const frame = document.createElement("iframe");
  frame.sandbox = "allow-scripts allow-pointer-lock";
  frame.allow = "autoplay";
  frame.srcdoc = page;
  frame.style.cssText = "width:100%;height:100%;border:0;display:block;background:#05070b";
  frame.title = game.title;
  const listen = (event) => {
    if (event.source !== frame.contentWindow || event.data?.source !== "kit") return;
    if (event.data.kind === "restart") return restart();
    if (event.data.kind === "ask") return answer(event.data.id, event.data.call);
    onMessage(event.data);
  };
  window.addEventListener("message", listen);
  frame.addEventListener("load", () => frame.focus());
  container.replaceChildren(frame);

  let asking = 0;
  async function answer(id, call) {
    // After a restart this frame is gone, and the answer goes nowhere.
    const reply = (body) => frame.contentWindow?.postMessage({ source: "host", kind: "answer", id, ...body }, "*");
    if (!call || typeof call !== "object") return reply({ error: "Bad question", status: 400 });
    if (call.kind === "listen") {
      if (!options.listen) return reply({ error: "Speaking isn't available here: type instead." });
      try {
        return reply({ result: await options.listen() });
      } catch (error) {
        return reply({ error: error.message });
      } finally {
        frame.focus();
      }
    }
    if (call.kind === "lessons") {
      const response = await fetch(`/api/live/${encodeURIComponent(game.id)}`).catch(() => null);
      return reply(response?.ok ? { result: await response.json() } : { error: "No lessons" });
    }
    if (asking >= MAX_ASKING) return reply({ error: "Meta's AI is busy with this game. Try again in a moment." });
    asking += 1;
    try {
      const response = await fetch("/api/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...call, game: game.id }) });
      const result = await response.json();
      if (!response.ok) {
        onMessage({ kind: "live", call, error: result.error, message: summarize(call, null, result.error) });
        return reply({ error: result.error, status: response.status });
      }
      onMessage({ kind: "live", call, result, message: summarize(call, result) });
      reply({ result });
    } catch (error) {
      reply({ error: `Couldn't reach the server: ${error.message}` });
    } finally {
      asking -= 1;
    }
  }

  function restart() {
    window.removeEventListener("message", listen);
    runGame(container, game, catalog, onMessage, options);
  }
  return {
    frame,
    stop() {
      window.removeEventListener("message", listen);
      frame.remove();
    },
  };
}
