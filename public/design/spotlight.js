// Spotlight: a soft light that follows the pointer inside a card and lights its border as it nears.
// A plain-JavaScript port of SpotlightCard from React Bits by David Haz
// (github.com/DavidHDev/react-bits, MIT + Commons Clause; see THIRD_PARTY.md). The light's falloff and
// motion are the original's; the React component became a function that adds the layers to any element.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** A light that fades smoothly from its core: the original's radial falloff, as CSS gradient stops. */
function falloff(color, softness) {
  const soft = clamp(softness, 0, 1);
  const core = (1 - soft) ** 1.5 * 0.85;
  const stop = (alpha, at) => `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(2)}%, transparent) ${(at * 100).toFixed(2)}%`;
  const list = [stop(1, 0)];
  for (let i = 0; i <= 14; i++) {
    const t = core + ((1 - core) * i) / 14;
    const g = (t - core) / (1 - core);
    const smooth = 1 - g * g * (3 - 2 * g);
    const glow = Math.exp(-4.6 * g * g) * (1 - g ** 6);
    list.push(stop(smooth + (glow - smooth) * soft, t));
  }
  return list.join(", ");
}

let styled = false;
function addStyle() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.textContent = `
    .spotlight-card { position: relative; isolation: isolate; overflow: hidden; }
    .spotlight-card__light, .spotlight-card__border, .spotlight-card__edge { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
    .spotlight-card__light { z-index: -1; opacity: 0; }
    .spotlight-card__border, .spotlight-card__edge { z-index: 1; padding: 1px;
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
      mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); }
    .spotlight-card__border { background: var(--spotlight-border, rgba(255, 255, 255, 0.08)); }
    .spotlight-card__edge { opacity: 0; }`;
  document.head.append(style);
}

/** Turns element into a spotlight card. Options as in React Bits: color, intensity, size, softness, borderGlow, proximity, smoothing. */
export function spotlight(element, { color = "#ffffff", intensity = 0.15, size = 240, softness = 0.7, borderGlow = 0.6, proximity = 80, smoothing = 0.3 } = {}) {
  addStyle();
  element.classList.add("spotlight-card");
  const layer = (name) => element.appendChild(Object.assign(document.createElement("span"), { className: `spotlight-card__${name}`, ariaHidden: "true" }));
  const light = layer("light");
  layer("border");
  const edge = layer("edge");
  const fill = falloff(color, softness);
  const rim = falloff(color, 1);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = { x: 0, y: 0, presence: 0, flare: 0, pressed: false };
  const pointer = { x: 0, y: 0, active: false };
  let raf = 0;
  let last = 0;

  const paint = () => {
    const grow = size * (1 + 0.2 * state.flare);
    const boost = 1 + 0.7 * state.flare;
    light.style.background = `radial-gradient(circle ${grow.toFixed(1)}px at ${state.x.toFixed(1)}px ${state.y.toFixed(1)}px, ${fill})`;
    edge.style.background = `radial-gradient(circle ${(grow * 0.6).toFixed(1)}px at ${state.x.toFixed(1)}px ${state.y.toFixed(1)}px, ${rim})`;
    light.style.opacity = String(Math.min(1, state.presence * intensity * boost));
    edge.style.opacity = String(Math.min(1, state.presence * borderGlow * boost));
  };
  const tick = (now) => {
    raf = 0;
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    const rect = element.getBoundingClientRect();
    let tx = state.x;
    let ty = state.y;
    let target = 0;
    if (pointer.active) {
      tx = pointer.x - rect.left;
      ty = pointer.y - rect.top;
      const gap = Math.hypot(Math.max(0, -tx, tx - rect.width), Math.max(0, -ty, ty - rect.height));
      target = gap === 0 ? 1 : proximity > 0 ? Math.max(0, 1 - gap / proximity) ** 2 : 0;
    }
    if (state.presence < 0.02 && target > 0) (state.x = tx), (state.y = ty);
    const follow = reduce || smoothing === 0 ? 1 : 1 - Math.exp(-dt / (0.015 + smoothing * 0.22));
    state.x += (tx - state.x) * follow;
    state.y += (ty - state.y) * follow;
    state.presence += (target - state.presence) * (reduce ? 1 : 1 - Math.exp(-dt / (target > state.presence ? 0.1 : 0.32)));
    if (Math.abs(target - state.presence) < 0.002) state.presence = target;
    const press = state.pressed && !reduce ? 1 : 0;
    state.flare += (press - state.flare) * (1 - Math.exp(-dt / (press ? 0.05 : 0.28)));
    if (Math.abs(press - state.flare) < 0.002) state.flare = press;
    paint();
    const moving = Math.abs(tx - state.x) > 0.1 || Math.abs(ty - state.y) > 0.1;
    if (moving || state.presence !== target || state.flare !== press) raf = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };
  addEventListener("pointermove", (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
    if (state.presence > 0 || element.contains(event.target) || proximity > 0) wake();
  });
  document.addEventListener("pointerout", (event) => !event.relatedTarget && ((pointer.active = false), wake()));
  element.addEventListener("pointerdown", () => ((state.pressed = true), wake()));
  addEventListener("pointerup", () => ((state.pressed = false), wake()));
  return element;
}
