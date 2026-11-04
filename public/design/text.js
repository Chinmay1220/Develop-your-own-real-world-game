// Text effects for the pages:
// - shinyText: a band of light sweeping across text, after ShinyText from React Bits by David Haz
//   (github.com/DavidHDev/react-bits, MIT + Commons Clause): the same colour band, angle, smooth easing
//   and pause between sweeps, without the React component.
// - textRotate: words that change in place, letter by letter, after TextRotate from Fancy Components by
//   Daniel Petho (github.com/danielpetho/fancy, MIT): the same defaults (each letter rises in from below
//   with a spring, the old word leaves upwards, one word every 2 s), with the Web Animations API instead
//   of React and Motion.
// See THIRD_PARTY.md.

const EASE_SMOOTH = (t) => 0.5 - Math.cos(Math.PI * t) / 2;

/** Sweeps a band of shineColor across element's text every few seconds. */
export function shinyText(element, { color = "#b5b5b5", shineColor = "#ffffff", speed = 2, delay = 1.2, angle = 120, shineWidth = 40 } = {}) {
  Object.assign(element.style, { backgroundRepeat: "no-repeat", backgroundSize: "100% 100%", webkitBackgroundClip: "text", backgroundClip: "text", webkitTextFillColor: "transparent", color: "transparent" });
  const half = shineWidth / 2;
  const paint = (position) => {
    element.style.backgroundImage = `linear-gradient(${angle}deg, ${color} 0%, ${color} ${position - half}%, ${shineColor} ${position}%, ${color} ${position + half}%, ${color} 100%)`;
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return paint(-100);
  const sweep = speed * 1000;
  const pause = delay * 1000;
  let start = performance.now();
  const frame = (now) => {
    const elapsed = (now - start) % (sweep + pause);
    const t = Math.min(1, elapsed / sweep);
    paint(-half - 10 + EASE_SMOOTH(t) * (100 + shineWidth + 20));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Cycles element through texts, one letter at a time (Fancy's TextRotate, "wait" mode). Returns { next, current }. */
export function textRotate(element, texts, { interval = 2600, stagger = 0.025, onChange } = {}) {
  let index = 0;
  element.classList.add("text-rotate");
  const springIn = "cubic-bezier(0.34, 1.36, 0.64, 1)"; // a light spring, like damping 25 / stiffness 300
  const build = (text) => {
    element.replaceChildren();
    element.setAttribute("aria-label", text);
    const words = text.split(" ");
    const letters = [];
    words.forEach((word, w) => {
      const holder = Object.assign(document.createElement("span"), { className: "text-rotate__word" });
      for (const char of Array.from(word)) {
        const clip = Object.assign(document.createElement("span"), { className: "text-rotate__clip" });
        const letter = Object.assign(document.createElement("span"), { className: "text-rotate__letter", textContent: char, ariaHidden: "true" });
        clip.append(letter);
        holder.append(clip);
        letters.push(letter);
      }
      element.append(holder);
      if (w < words.length - 1) element.append(" ");
    });
    return letters;
  };
  let letters = build(texts[0]);
  const show = async (next) => {
    await Promise.all(letters.map((letter, i) => letter.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-120%)", opacity: 0 }], { duration: 260, delay: i * stagger * 1000 * 0.5, easing: "ease-in", fill: "forwards" }).finished));
    index = next;
    letters = build(texts[index]);
    onChange?.(texts[index], index);
    letters.forEach((letter, i) => letter.animate([{ transform: "translateY(100%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 520, delay: i * stagger * 1000, easing: springIn, fill: "backwards" }));
  };
  const timer = setInterval(() => show((index + 1) % texts.length), interval);
  return { next: () => show((index + 1) % texts.length), jump: (i) => show(i), get current() { return texts[index]; }, stop: () => clearInterval(timer) };
}
