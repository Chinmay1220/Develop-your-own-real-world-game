// Rewind: send a photo of an aftermath, then show the evidence, the ranked explanations and the moments
// before, painted backwards from the photo. The server does the thinking (Muse Wonder) and painting (Muse Image).

const $ = (id) => document.getElementById(id);
let photo = null; // the chosen photo, as a JPEG data URL
let record = null; // the case from the server
let chosen = 0; // the explanation on screen
let showing = -1; // the moment on screen; -1 is the photo ("now")
let front = $("view-a");
let back = $("view-b");

// Choosing a photo --------------------------------------------------------------------------------
/** Shrinks a photo to at most 1600 px and returns it as a JPEG data URL. */
function shrink(source) {
  return new Promise((done, fail) => {
    const picture = new Image();
    picture.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(picture.width, picture.height));
      const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(picture.width * scale), height: Math.round(picture.height * scale) });
      canvas.getContext("2d").drawImage(picture, 0, 0, canvas.width, canvas.height);
      done(canvas.toDataURL("image/jpeg", 0.88));
    };
    picture.onerror = () => fail(new Error("That file isn't a photo the browser can open."));
    picture.src = source;
  });
}

async function choose(source) {
  photo = await shrink(source);
  $("preview").src = photo;
  $("preview").hidden = false;
  $("drop-text").textContent = "Click to choose another photo";
  $("rewind").disabled = false;
}

$("file").addEventListener("change", () => {
  const file = $("file").files[0];
  if (file) choose(URL.createObjectURL(file)).catch((error) => say(error.message, true));
});
for (const name of ["dragenter", "dragover"]) $("drop").addEventListener(name, (event) => (event.preventDefault(), $("drop").classList.add("over")));
for (const name of ["dragleave", "drop"]) $("drop").addEventListener(name, () => $("drop").classList.remove("over"));
$("drop").addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file) choose(URL.createObjectURL(file)).catch((error) => say(error.message, true));
});
$("example").addEventListener("click", async () => {
  await choose("/assets/rewind/car-guardrail.jpg");
  $("context").value = "It was raining.";
  start();
});
$("rewind").addEventListener("click", () => start());

function say(text, error = false) {
  $("status").className = error ? "error" : "";
  $("status").textContent = text;
}

// Investigating -----------------------------------------------------------------------------------
let tick = null;
function working(text) {
  clearInterval(tick);
  $("shimmer").classList.toggle("on", Boolean(text));
  $("working").hidden = !text;
  if (!text) return;
  const started = Date.now();
  const show = () => ($("working").textContent = `${text} ${Math.round((Date.now() - started) / 1000)} s`);
  show();
  tick = setInterval(show, 500);
}

async function call(path, body) {
  const response = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Something went wrong");
  return result;
}

async function start() {
  if (!photo) return;
  $("rewind").disabled = $("example").disabled = true;
  const started = Date.now();
  const timer = setInterval(() => say(`Muse Wonder is investigating the photo: reading the evidence and working backwards… ${Math.round((Date.now() - started) / 1000)} s`), 500);
  try {
    record = await call("/api/rewind/start", { photo, context: $("context").value.trim() });
    history.replaceState(null, "", `?case=${record.id}`);
    open();
  } catch (error) {
    say(error.message, true);
  } finally {
    clearInterval(timer);
    $("rewind").disabled = $("example").disabled = false;
  }
}

// Showing the case --------------------------------------------------------------------------------
function open() {
  $("start").hidden = true;
  $("case").hidden = false;
  $("scene").textContent = record.scene;
  $("summary").textContent = record.summary;
  $("evidence").replaceChildren(
    ...record.evidence.map((item, i) => {
      const line = document.createElement("li");
      line.innerHTML = `<b>${i + 1}</b><span></span>`;
      line.querySelector("span").textContent = item.label;
      return line;
    }),
  );
  $("pins").replaceChildren(
    ...record.evidence.map((item, i) => {
      const pin = Object.assign(document.createElement("div"), { className: "pin", textContent: String(i + 1) });
      pin.style.left = `${item.x * 100}%`;
      pin.style.top = `${item.y * 100}%`;
      return pin;
    }),
  );
  renderTheories();
  pick(0);
}

function renderTheories() {
  $("theories").replaceChildren(
    ...record.hypotheses.map((theory, h) => {
      const card = document.createElement("div");
      card.className = `theory${h === chosen ? " active" : ""}`;
      card.innerHTML = `<div class="top"><span class="title"></span><span>${theory.likelihood}%</span></div><div class="bar"><i style="width:${theory.likelihood}%"></i></div><p class="physics"></p><div class="more"><p class="for"></p><p class="against"></p><p class="prevent"></p></div>`;
      card.querySelector(".title").textContent = `${h + 1}. ${theory.title}`;
      card.querySelector(".physics").textContent = theory.physics;
      card.querySelector(".for").textContent = theory.supports.length ? `For: ${theory.supports.join("; ")}` : "";
      card.querySelector(".against").textContent = theory.against.length ? `Against: ${theory.against.join("; ")}` : "";
      card.querySelector(".prevent").textContent = `Could have prevented it: ${theory.prevention}`;
      card.addEventListener("click", () => pick(h));
      return card;
    }),
  );
}

/** Shows one explanation: its timeline, painting its moments if they aren't painted yet. */
async function pick(h) {
  chosen = h;
  renderTheories();
  let theory = record.hypotheses[h];
  if (theory.painted.every((state) => state === "waiting")) {
    record = await call("/api/rewind/paint", { id: record.id, hypothesis: h });
    theory = record.hypotheses[h];
  }
  renderTimeline(theory);
  show(-1);
  const waiting = theory.painted.filter((state) => state === "painting").length;
  if (waiting) {
    working(`Muse Image is painting the ${waiting} moments before, backwards from the photo…`);
    await Promise.all(theory.frames.map((url) => loaded(url)));
    if (chosen === h) working(null);
  }
}

const loaded = (url) => new Promise((done) => Object.assign(new Image(), { onload: done, onerror: done, src: url }));

function renderTimeline(theory) {
  const moments = theory.timeline.map((moment, n) => ({ label: `${moment.secondsBefore} s before`, url: theory.frames[n], n }));
  $("timeline").replaceChildren(
    ...[...moments, { label: "Now: the photo", url: record.photo, n: -1 }].map((moment) => {
      const button = document.createElement("button");
      button.className = "moment";
      button.dataset.n = moment.n;
      button.innerHTML = `<div class="thumb"><div class="wait">painting…</div><img alt="" hidden></div><span></span>`;
      button.querySelector("span").textContent = moment.label;
      const thumb = button.querySelector("img");
      thumb.onload = () => ((thumb.hidden = false), button.querySelector(".wait").remove());
      thumb.src = moment.url;
      button.addEventListener("click", () => show(moment.n));
      return button;
    }),
    Object.assign(document.createElement("button"), { id: "play", textContent: "▶ Play", onclick: play }),
  );
}

/** Shows a moment (or the photo, -1) in the big viewer, with a crossfade. */
function show(n) {
  showing = n;
  const theory = record.hypotheses[chosen];
  const url = n < 0 ? record.photo : theory.frames[n];
  for (const button of $("timeline").querySelectorAll(".moment")) button.classList.toggle("active", Number(button.dataset.n) === n);
  const seconds = n < 0 ? 0 : theory.timeline[n].secondsBefore;
  $("stamp").textContent = n < 0 ? "Now: the photo" : `${seconds} second${seconds === 1 ? "" : "s"} before`;
  $("stamp").className = n < 0 ? "" : "past";
  $("caption").textContent = n < 0 ? record.summary : theory.timeline[n].what;
  $("pins").style.opacity = n < 0 ? "1" : "0";
  return new Promise((done) => {
    const picture = new Image();
    picture.onload = picture.onerror = () => {
      if (showing !== n) return done();
      back.src = picture.src;
      back.classList.add("shown");
      front.classList.remove("shown");
      [front, back] = [back, front];
      done();
    };
    picture.src = url;
  });
}

/** Plays the explanation forward: the earliest moment, then each one after it, ending on the photo. */
async function play() {
  const theory = record.hypotheses[chosen];
  for (let n = 0; n < theory.timeline.length; n++) {
    await show(n);
    await new Promise((done) => setTimeout(done, 2600));
  }
  await show(-1);
}

$("new-case").addEventListener("click", () => {
  history.replaceState(null, "", location.pathname);
  $("case").hidden = true;
  $("start").hidden = false;
  working(null);
  say("");
});

// A case in the address bar: open it again.
const saved = new URLSearchParams(location.search).get("case");
if (saved) {
  try {
    record = await call(`/api/rewind/${encodeURIComponent(saved)}`);
    open();
  } catch {
    history.replaceState(null, "", location.pathname);
  }
}
