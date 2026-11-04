// Drives headless Microsoft Edge through the DevTools protocol, in real time: open a page, hold keys,
// click, read the console and take screenshots. It tests the games the AI writes.
// Needs Edge (it comes with Windows); set EDGE_PATH if it is somewhere else.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const KEYS: Record<string, [string, number]> = {
  KeyW: ["w", 87],
  KeyA: ["a", 65],
  KeyS: ["s", 83],
  KeyD: ["d", 68],
  KeyE: ["e", 69],
  KeyF: ["f", 70],
  ArrowUp: ["ArrowUp", 38],
  ArrowDown: ["ArrowDown", 40],
  ArrowLeft: ["ArrowLeft", 37],
  ArrowRight: ["ArrowRight", 39],
  Space: [" ", 32],
  Enter: ["Enter", 13],
  ShiftLeft: ["Shift", 16],
};

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface Reply {
  id?: number;
  method?: string;
  params?: Record<string, any>;
  result?: Record<string, any>;
}

export class Browser {
  readonly console: string[] = []; // console lines and page errors, in order
  #edge: ChildProcess;
  #socket: WebSocket;
  #profile: string;
  #pending = new Map<number, (reply: Reply) => void>();
  #next = 1;

  private constructor(edge: ChildProcess, socket: WebSocket, profile: string) {
    this.#edge = edge;
    this.#socket = socket;
    this.#profile = profile;
    socket.addEventListener("message", (event) => {
      const reply = JSON.parse(String(event.data)) as Reply;
      if (reply.id && this.#pending.has(reply.id)) {
        this.#pending.get(reply.id)!(reply);
        this.#pending.delete(reply.id);
      } else if (reply.method === "Runtime.consoleAPICalled") {
        this.console.push(reply.params!.args.map((arg: { value?: unknown; description?: string }) => arg.value ?? arg.description).join(" "));
      } else if (reply.method === "Runtime.exceptionThrown") {
        const details = reply.params!.exceptionDetails;
        this.console.push(`PAGE ERROR: ${details.exception?.description ?? details.text}`);
      }
    });
  }

  static async open({ width = 1280, height = 760 } = {}): Promise<Browser> {
    const profile = mkdtempSync(join(tmpdir(), "heist-edge-"));
    const port = 9300 + Math.floor(Math.random() * 600);
    const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, "--use-angle=d3d11", "--ignore-gpu-blocklist", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
    let page: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 60 && !page; i++) {
      await sleep(200);
      try {
        const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        page = targets.find((target) => target.type === "page");
      } catch {
        // Edge is still starting
      }
    }
    if (!page) {
      edge.kill();
      throw new Error(`Could not start Edge for testing (looked for ${EDGE})`);
    }
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((done, fail) => {
      socket.addEventListener("open", done);
      socket.addEventListener("error", fail);
    });
    const browser = new Browser(edge, socket, profile);
    await browser.send("Runtime.enable");
    await browser.send("Page.enable");
    return browser;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Reply> {
    return new Promise((done) => {
      const id = this.#next++;
      this.#pending.set(id, done);
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  goto(url: string) {
    return this.send("Page.navigate", { url });
  }

  #key(type: "keyDown" | "keyUp", code: string) {
    const [key, keyCode] = KEYS[code] ?? [code, 0];
    return this.send("Input.dispatchKeyEvent", { type, code, key, windowsVirtualKeyCode: keyCode });
  }

  /** Holds keys down together for a while. */
  async hold(codes: string[], ms: number) {
    for (const code of codes) await this.#key("keyDown", code);
    await sleep(ms);
    for (const code of codes) await this.#key("keyUp", code);
  }

  async press(code: string) {
    await this.hold([code], 60);
  }

  /** Types text into whatever has the focus, such as the box for talking to the world model. */
  async type(text: string) {
    await this.send("Input.insertText", { text });
  }

  async click(x: number, y: number) {
    for (const type of ["mousePressed", "mouseReleased"]) await this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }

  /** A PNG, or a smaller JPEG for sending to a model. */
  async screenshot(format: "png" | "jpeg" = "png"): Promise<Buffer> {
    const reply = await this.send("Page.captureScreenshot", format === "jpeg" ? { format, quality: 70 } : { format });
    return Buffer.from(reply.result!.data as string, "base64");
  }

  async close() {
    await Promise.race([this.send("Browser.close"), sleep(1500)]); // Edge may close before it answers
    this.#edge.kill();
    await sleep(300);
    try {
      rmSync(this.#profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    } catch {
      // Windows can keep Edge's files locked a moment longer; a leftover temporary folder does no harm.
    }
  }
}
