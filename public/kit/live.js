// Meta's AI inside the game. kit.world(...) gives a game a world model: the player presses Enter and
// types or says anything to try, and the model decides what really happens. kit.mind(...) gives a
// character a mind that chooses its plans. After each round a teacher writes lessons, so the next
// round's world and characters are smarter. The game runs sealed with no network, so every question
// goes to the page around it, which asks the server (POST /api/live).

const MAX_MINDS = 4;
const MIN_EVERY = 4; // seconds between a mind's thoughts
const HISTORY = 60;
const DATA_LIMIT = 6000; // characters of JSON for state() and sees()

export function createLive({ report, scene, THREE, label, setPaused, clearKeys, now, isOver }) {
  // Questions and answers through the page around the game -------------------------------------
  let asked = 0;
  const waiting = new Map();
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.data?.source !== "host" || event.data.kind !== "answer") return;
    const wait = waiting.get(event.data.id);
    if (!wait) return;
    waiting.delete(event.data.id);
    if (event.data.error) wait.reject(Object.assign(new Error(event.data.error), { status: event.data.status }));
    else wait.resolve(event.data.result);
  });
  function ask(call, seconds = 60) {
    if (window.parent === window) return Promise.reject(new Error("Meta's AI works only inside the game page"));
    return new Promise((resolve, reject) => {
      const id = ++asked;
      waiting.set(id, { resolve, reject });
      report({ kind: "ask", id, call });
      setTimeout(() => waiting.delete(id) && reject(new Error("Meta's AI took too long to answer")), seconds * 1000);
    });
  }

  /** A failed question: the game's own mistakes go back to its writer; the rest is only shown. */
  let shownFailure = "";
  function failed(error, who) {
    if (error.status === 400) return report({ kind: "error", message: `${who}: ${error.message}` });
    if (error.message !== shownFailure) feed("Meta's AI", error.message, "#ef8a7a");
    shownFailure = error.message;
  }

  // What happened this round, for the minds and for learning afterwards --------------------------
  const history = [];
  /** why is a character's private thinking; seen is what characters could notice of a world event. */
  function remember(who, text, { why = "", seen = null } = {}) {
    history.push({ t: Math.round(now()), who, text: String(text).slice(0, 300), why, seen });
    if (history.length > HISTORY) history.splice(0, history.length - HISTORY);
  }
  /**
   * Recent moments as one character may know them: what it could notice of the world's events, not
   * what the player typed or the player's side of the story, and not other characters' thoughts.
   */
  const recentFor = (name, count = 12) =>
    history
      .filter(({ who, seen }) => who !== "player" && seen !== "")
      .slice(-count)
      .map(({ t, who, text, why, seen }) => ({ t, who, text: seen ?? (why && who === name ? `${text} (my thinking: ${why})` : text) }));

  /** Game data as small plain JSON, with numbers rounded. Mistakes here are the writer's to fix. */
  function plain(value, where) {
    let json;
    try {
      json = JSON.stringify(value ?? null, (key, item) => (typeof item === "number" ? Math.round(item * 100) / 100 : item));
    } catch (error) {
      throw new Error(`${where} must return plain data (names, numbers, short lists), not three.js objects: ${error.message}`);
    }
    if (json.length > DATA_LIMIT) throw new Error(`${where} returned ${json.length} characters of JSON; keep it under ${DATA_LIMIT}`);
    return JSON.parse(json);
  }

  function check(spec, where, fields) {
    if (!spec || typeof spec !== "object") throw new Error(`${where} needs an object`);
    if (typeof spec.about !== "string" || !spec.about.trim()) throw new Error(`${where} needs about: a few sentences about the game`);
    for (const field of fields) if (typeof spec[field] !== "function") throw new Error(`${where} needs ${field}: a function returning plain data`);
    if (!spec.can || typeof spec.can !== "object") throw new Error(`${where} needs can: { name: { does, with, run } }`);
    for (const [name, change] of Object.entries(spec.can)) {
      if (typeof change?.does !== "string") throw new Error(`${where}: can.${name} needs does: what it does`);
      if (typeof change.run !== "function") throw new Error(`${where}: can.${name} needs run(input): a function that does it`);
    }
  }
  const wire = (can) => Object.fromEntries(Object.entries(can).map(([name, change]) => [name, { does: change.does, with: change.with ?? {} }]));
  const describe = (changes) => changes.map(({ name, input }) => `${name}(${Object.entries(input).map(([key, value]) => `${key}=${value}`).join(", ")})`).join(", ");

  function apply(can, changes, who) {
    for (const change of changes) {
      try {
        can[change.name]?.run(change.input);
      } catch (error) {
        report({ kind: "error", message: `${who}: the change "${change.name}" failed: ${error.message}\n${error.stack ?? ""}`.slice(0, 1500) });
      }
    }
  }

  // On screen ------------------------------------------------------------------------------------
  const style = document.createElement("style");
  style.textContent = `
    .live { position: fixed; font-family: system-ui, sans-serif; color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,.8); pointer-events: none; }
    .live[hidden] { display: none !important; }
    #live-feed { left: 16px; bottom: 54px; width: min(460px, 60vw); display: flex; flex-direction: column; gap: 6px; }
    #live-feed div { padding: 7px 11px; border-radius: 10px; background: rgba(8, 12, 20, .72); font-size: 15px; line-height: 1.35; transition: opacity 1s; }
    #live-feed b { margin-right: 6px; }
    #live-hint { right: 16px; bottom: 54px; font-size: 13px; padding: 5px 10px; border-radius: 9px; background: rgba(0,0,0,.45); }
    #live-hint kbd { font: inherit; font-weight: 800; padding: 0 5px; border-radius: 4px; background: rgba(255,255,255,.18); }
    #live-busy { left: 50%; top: 14px; transform: translateX(-50%); font-size: 14px; padding: 6px 12px; border-radius: 10px; background: rgba(8, 12, 20, .75); }
    #live-busy::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 8px; border-radius: 50%; background: #f5b942; animation: live-pulse 1s infinite alternate; }
    @keyframes live-pulse { from { opacity: .25 } to { opacity: 1 } }
    #live-box { left: 50%; bottom: 60px; transform: translateX(-50%); width: min(640px, 86vw); pointer-events: auto; display: flex; gap: 8px; padding: 10px; border-radius: 14px; background: rgba(8, 12, 20, .88); box-shadow: 0 8px 30px rgba(0,0,0,.5); }
    #live-box input { flex: 1; min-width: 0; padding: 9px 12px; border: 1px solid #34415f; border-radius: 9px; background: #0b1019; color: #fff; font: inherit; font-size: 16px; outline: none; }
    #live-box button { border: 0; border-radius: 9px; padding: 0 14px; font: inherit; font-weight: 700; cursor: pointer; background: #2a3550; color: #fff; }
    #live-box button.on { background: #ef5d5d; }
    #live-lessons { left: 50%; top: 56px; transform: translateX(-50%); width: min(560px, 86vw); padding: 12px 16px; border-radius: 14px; background: rgba(8, 12, 20, .82); font-size: 14px; line-height: 1.45; transition: opacity 1.2s; }
    #live-lessons b { color: #f5b942; }
    #live-lessons li { margin-top: 3px; }
    #live-learning { left: 50%; bottom: 96px; transform: translateX(-50%); width: min(620px, 86vw); text-align: center; font-size: 17px; font-weight: 600; line-height: 1.4; }`;
  document.head.append(style);
  const element = (id, tag = "div") => Object.assign(document.body.appendChild(document.createElement(tag)), { id, className: "live" });
  const feedBox = element("live-feed");
  const busy = element("live-busy");
  busy.hidden = true;

  /** A line at the bottom left, such as what the world decided or what a character said. It fades. */
  function feed(who, text, color = "#f5b942") {
    if (!text) return;
    const line = document.createElement("div");
    line.innerHTML = `<b style="color:${color}"></b><span></span>`;
    line.querySelector("b").textContent = `${who}:`;
    line.querySelector("span").textContent = text;
    feedBox.append(line);
    while (feedBox.children.length > 3) feedBox.firstChild.remove();
    setTimeout(() => (line.style.opacity = "0"), 9000);
    setTimeout(() => line.remove(), 10_000);
  }

  let busyCount = 0;
  const working = (on, text) => {
    busyCount += on ? 1 : -1;
    if (text) busy.textContent = text;
    busy.hidden = busyCount <= 0;
  };

  // Words above a character, for a few seconds.
  const bubbles = [];
  function bubble(body, text) {
    if (!body?.isObject3D) return;
    for (const old of bubbles.filter((item) => item.body === body)) old.until = 0;
    const sprite = label(`“${text}”`, { size: 1.3 });
    const top = new THREE.Box3().setFromObject(body).max.y - body.getWorldPosition(new THREE.Vector3()).y;
    bubbles.push({ body, sprite, until: now() + 5, lift: Math.max(1, top) + 0.8 });
    scene.add(sprite);
  }

  // Lessons from earlier rounds, shown at the start ----------------------------------------------
  let lessons = null;
  let lessonsReady = null;
  function loadLessons() {
    lessonsReady ??= ask({ kind: "lessons" }, 20)
      .then((learned) => {
        lessons = learned;
        if (learned?.rounds) showLessons(learned);
      })
      .catch(() => {});
    return lessonsReady;
  }
  function showLessons(learned) {
    const panel = element("live-lessons");
    const tips = [...Object.entries(learned.minds).flatMap(([name, list]) => list.map((tip) => `${name}: ${tip}`)), ...learned.world].slice(0, 4);
    panel.innerHTML = `<b></b><div></div><ul></ul>`;
    panel.querySelector("b").textContent = `Round ${learned.rounds + 1}: Meta's AI learned from ${learned.rounds} round${learned.rounds === 1 ? "" : "s"}`;
    panel.querySelector("div").textContent = learned.summary;
    for (const tip of tips) panel.querySelector("ul").appendChild(document.createElement("li")).textContent = tip;
    setTimeout(() => (panel.style.opacity = "0"), 9000);
    setTimeout(() => panel.remove(), 10_500);
  }

  // The world model ------------------------------------------------------------------------------
  let world = null;
  let worldSpec = null;
  let typing = false;

  function makeWorld(spec) {
    check(spec, "kit.world", ["state"]);
    if (world) throw new Error("kit.world can only be made once per game");
    worldSpec = spec;
    loadLessons();
    let queue = Promise.resolve();
    let queued = 0;
    const can = wire(spec.can);

    async function decide(text, by) {
      if (isOver()) return null;
      const call = { kind: "act", by, text, about: spec.about, state: plain(spec.state(), "kit.world state()"), can, recent: history.slice(-12).map(({ t, who, text }) => ({ t, who, text })) };
      remember(by, by === "game" ? `asked the world: ${text}` : `tried: ${text}`);
      if (by === "player") feed("You", text, "#9fd3ff");
      working(true, "Meta's world model is deciding what happens…");
      try {
        const result = await ask(call);
        if (isOver()) return null;
        apply(spec.can, result.changes, "kit.world");
        remember("world", `${result.story}${result.changes.length ? ` [${describe(result.changes)}]` : ""}`, { seen: result.noticed ?? "" });
        feed("World", result.story);
        // Characters react to what they noticed, instead of carrying on with an old plan.
        if (result.changes.length && result.noticed) for (const mind of minds) mind.think(`You notice: ${result.noticed}`);
        return { story: result.story, changes: result.changes };
      } catch (error) {
        failed(error, "kit.world");
        return null;
      } finally {
        working(false);
      }
    }

    world = {
      /** The player tries something (the kit calls this for what they type or say). Returns { story, changes }. */
      act(text, { by = "player" } = {}) {
        text = String(text ?? "").trim().slice(0, 300);
        if (!text) return Promise.resolve(null);
        if (queued >= 2) {
          feed("World", "Wait a moment: the world is still answering.");
          return Promise.resolve(null);
        }
        queued += 1;
        const turn = queue.then(() => decide(text, by)).finally(() => (queued -= 1));
        queue = turn.catch(() => {});
        return turn;
      },
      /** Asks the world model about something the game's code can't decide. */
      happen: (text) => world.act(text, { by: "game" }),
      /** Writes down an important moment, so the AI can learn from the round. */
      note: (text) => remember("game", text),
      get lessons() {
        return lessons?.world ?? [];
      },
    };
    makeSayBox();
    return world;
  }

  // The box for typing or saying anything ---------------------------------------------------------
  let box = null;
  function makeSayBox() {
    const hint = element("live-hint");
    hint.innerHTML = "<kbd>Enter</kbd> Say or type anything to try";
    box = element("live-box");
    box.hidden = true;
    box.innerHTML = `<input maxlength="300" placeholder="Anything you want to try… (Enter to send, Esc to cancel)"><button title="Speak instead of typing">Speak</button>`;
    const input = box.querySelector("input");
    const speak = box.querySelector("button");
    const open = () => {
      if (isOver()) return;
      typing = true;
      clearKeys();
      setPaused(true);
      document.exitPointerLock?.();
      box.hidden = false;
      input.value = "";
      input.focus();
    };
    const close = () => {
      typing = false;
      box.hidden = true;
      input.blur();
      setPaused(false);
      window.focus();
    };
    const send = (text) => {
      close();
      if (text.trim()) world.act(text);
    };
    window.addEventListener(
      "keydown",
      (event) => {
        if (!typing) {
          if (event.code === "Enter" || event.code === "NumpadEnter") (event.preventDefault(), open());
          return;
        }
        event.stopPropagation(); // the game doesn't see keys typed into the box
        if (event.code === "Enter" || event.code === "NumpadEnter") (event.preventDefault(), send(input.value));
        if (event.code === "Escape") close();
      },
      true,
    );
    speak.addEventListener("click", async () => {
      if (speak.classList.contains("on")) return;
      speak.classList.add("on");
      speak.textContent = "Listening…";
      input.placeholder = "Speak now. I stop listening when you pause.";
      try {
        const { text } = await ask({ kind: "listen" }, 90);
        input.value = text ?? "";
        if (text) send(text);
      } catch (error) {
        input.placeholder = error.message;
      } finally {
        speak.classList.remove("on");
        speak.textContent = "Speak";
      }
    });
  }

  // Characters' minds ------------------------------------------------------------------------------
  const minds = [];

  function makeMind(spec) {
    check(spec, "kit.mind", ["sees"]);
    const name = String(spec.name ?? "").trim();
    if (!name) throw new Error("kit.mind needs name: the character's name");
    if (minds.some((mind) => mind.name === name)) throw new Error(`There is already a mind called "${name}"`);
    if (minds.length >= MAX_MINDS) throw new Error(`Use at most ${MAX_MINDS} minds`);
    const every = spec.every === 0 ? 0 : Math.max(MIN_EVERY, Number(spec.every) || 6);
    const can = wire(spec.can);
    let thinking = false;
    loadLessons();

    const mind = {
      name,
      thought: "",
      said: "",
      next: now() + 1.5 + minds.length * 1.2, // spread out the first thoughts
      /** Thinks now, optionally about something that just happened. Returns { thought, say, changes }. */
      async think(event = "") {
        if (thinking || isOver()) return null;
        thinking = true;
        mind.next = now() + every;
        try {
          await loadLessons();
          const call = { kind: "think", name, about: spec.about, sees: plain(spec.sees(), `kit.mind "${name}" sees()`), can, event: String(event).slice(0, 300), recent: recentFor(name) };
          const result = await ask(call, 45);
          if (isOver()) return null;
          apply(spec.can, result.changes, `kit.mind "${name}"`);
          remember(name, `chose ${describe(result.changes) || "nothing"}${result.say ? `, said "${result.say}"` : ""}`, { why: result.thought });
          mind.thought = result.thought;
          mind.said = result.say;
          if (result.say) {
            feed(name, `“${result.say}”`, "#7fe3d0");
            bubble(spec.body, result.say);
          }
          return result;
        } catch (error) {
          failed(error, `kit.mind "${name}"`);
          return null;
        } finally {
          thinking = false;
        }
      },
      get lessons() {
        return lessons?.minds?.[name] ?? [];
      },
      every,
      about: spec.about,
    };
    minds.push(mind);
    return mind;
  }

  // Every frame, and when the round ends ---------------------------------------------------------
  const position = new THREE.Vector3();
  function tick() {
    for (const mind of minds) if (mind.every && now() >= mind.next) mind.think();
    for (const item of [...bubbles]) {
      if (now() > item.until) {
        scene.remove(item.sprite);
        item.sprite.material.map?.dispose();
        item.sprite.material.dispose();
        bubbles.splice(bubbles.indexOf(item), 1);
        continue;
      }
      item.body.getWorldPosition(position);
      item.sprite.position.set(position.x, position.y + item.lift, position.z);
    }
  }

  /** After a win or loss, the teacher studies the round and writes lessons for the next one. */
  function roundOver(result, message) {
    if (box && typing) box.querySelector("input").blur();
    if (!world && minds.length === 0) return;
    if (!history.some((moment) => moment.who !== "game")) return; // the AI did nothing this round
    const note = element("live-learning");
    note.textContent = "Meta's AI is learning from this round…";
    let state = null;
    try {
      if (worldSpec) state = plain(worldSpec.state(), "kit.world state()");
    } catch {}
    const call = {
      kind: "learn",
      result,
      message,
      about: worldSpec?.about ?? minds[0].about,
      state,
      minds: minds.map(({ name, about }) => ({ name, about })),
      history: history.map(({ t, who, text, why }) => ({ t, who, text: why ? `${text} (thinking: ${why})` : text })),
    };
    ask(call, 150)
      .then((learned) => (note.textContent = `Learned: ${learned.summary}`))
      .catch((error) => (note.textContent = `Learning failed: ${error.message}`));
  }

  return {
    world: makeWorld,
    mind: makeMind,
    tick,
    roundOver,
    get typing() {
      return typing;
    },
  };
}
