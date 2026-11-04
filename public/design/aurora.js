// Aurora: a slow, glowing aurora drawn by a WebGL2 shader, reaching toward the pointer.
// A plain-JavaScript port of the Aurora background from React Bits by David Haz
// (github.com/DavidHDev/react-bits, MIT + Commons Clause; see THIRD_PARTY.md). The shader is unchanged;
// the React component around it became one function.

const MAX_STOPS = 5;
const MAX_LAYERS = 3;
const INTRO_SECONDS = 2.4;

const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uStops[${MAX_STOPS}];
uniform int uStopCount;
uniform float uAmplitude;
uniform float uBlend;
uniform float uHeight;
uniform float uScale;
uniform float uGlow;
uniform float uBrightness;
uniform int uLayers;
uniform float uFlip;
uniform vec3 uPointer;
uniform float uReveal;
uniform float uOpacity;
out vec4 outColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 ramp(float t) {
  float x = clamp(t, 0.0, 1.0) * float(uStopCount - 1);
  int i = int(min(floor(x), float(uStopCount - 2)));
  float f = x - float(i);
  f = f * f * (3.0 - 2.0 * f);
  vec3 lch = mix(uStops[i], uStops[i + 1], f);
  return toSrgb(oklabToLinear(vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z))));
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float y = 1.0 - frag.y / uResolution.y;
  y = mix(y, 1.0 - y, uFlip);
  float u = frag.x / uResolution.x;
  float X = (frag.x - uResolution.x * 0.5) / uResolution.y;
  float t = uTime;
  float reach = uPointer.z * exp(-pow((X - uPointer.x) / 0.38, 2.0));

  vec3 glow = vec3(0.0);
  float cover = 0.0;
  for (int k = 0; k < ${MAX_LAYERS}; k++) {
    if (k >= uLayers) break;
    float layer = float(k);
    float seed = layer * 13.7;
    float pace = t * (1.0 - layer * 0.18);
    float warp = snoise(vec2(X * 0.45 * uScale + pace * 0.02 + seed, pace * 0.05 + seed));
    float wave = snoise(vec2(X * 0.75 * uScale + warp * 0.35 - pace * 0.03 + seed, pace * 0.07 - seed)) * 0.72
      + snoise(vec2(X * 1.6 * uScale + warp * 0.5 + pace * 0.04 - seed, pace * 0.1 + seed * 0.5)) * 0.28;
    float hem = uHeight + layer * 0.07 + wave * 0.15 * uAmplitude;
    hem += reach * 0.08 * (layer < 0.5 ? 1.0 : 0.4);
    hem = mix(-0.25, hem, uReveal);

    float soft = (0.04 + uBlend * 0.16) * (1.0 + layer * 0.9);
    float rise = hem - y;
    float low = -soft - uGlow * 0.14;
    float high = 0.26 + soft * 0.6;
    float body = pow(smootherstep(low, high, rise), 1.5 + uGlow * 0.6);
    float lobes = 0.86 + 0.14 * snoise(vec2(X * 0.9 * uScale - pace * 0.025 + seed, y * 0.3 + pace * 0.04));
    float alpha = body * lobes * (layer < 0.5 ? 1.0 : 0.32 / layer);
    alpha = clamp(alpha * (1.0 + reach * 0.25 * smootherstep(0.9, 0.0, abs(y - hem))), 0.0, 1.0);

    vec3 tint = ramp(u + 0.05 * sin(pace * 0.08 + layer * 2.3) + layer * 0.1 + max(rise, 0.0) * 0.05);
    glow = 1.0 - (1.0 - glow) * (1.0 - tint * alpha);
    cover = 1.0 - (1.0 - cover) * (1.0 - alpha);
  }

  float fade = smootherstep(0.0, 0.7, uReveal) * uOpacity;
  float strength = clamp(uBrightness, 0.0, 2.0);
  glow *= fade * min(strength, 1.0);
  cover *= fade * min(strength, 1.0);
  glow = 1.0 - pow(1.0 - glow, vec3(max(strength, 1.0)));
  float dither = (hash(frag) - 0.5) / 255.0;
  outColor = vec4(glow + dither, clamp(cover + dither, 0.0, 1.0));
}`;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toOklch = (rgb) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lab = [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  return [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
};

const unwrapHues = (stops) => {
  const known = stops.findIndex((stop) => stop[1] > 0.02);
  let previous = known === -1 ? 0 : stops[known][2];
  return stops.map((stop) => {
    let hue = stop[1] > 0.02 ? stop[2] : previous;
    while (hue - previous > Math.PI) hue -= Math.PI * 2;
    while (hue - previous < -Math.PI) hue += Math.PI * 2;
    previous = hue;
    return [stop[0], stop[1], hue];
  });
};

function link(gl) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  const uniforms = {};
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name.replace("[0]", "")] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

/** Fills container with an aurora. Options as in React Bits: colorStops, amplitude, blend, speed, height, scale, glow, brightness, layers, direction. */
export function aurora(container, options = {}) {
  const s = {
    stops: (options.colorStops ?? ["#5227FF", "#7cff67", "#5227FF"]).slice(0, MAX_STOPS),
    amplitude: Math.max(0, options.amplitude ?? 1),
    blend: clamp(options.blend ?? 0.5, 0, 1),
    speed: options.speed ?? 1,
    height: clamp(options.height ?? 0.45, 0, 1),
    scale: Math.max(0.1, options.scale ?? 1),
    glow: Math.max(0, options.glow ?? 0.6),
    brightness: Math.max(0, options.brightness ?? 1),
    layers: clamp(Math.round(options.layers ?? 1), 1, MAX_LAYERS),
    flip: options.direction === "bottom" ? 1 : 0,
    opacity: clamp(options.opacity ?? 1, 0, 1),
  };
  const canvas = Object.assign(document.createElement("canvas"), { ariaHidden: "true" });
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  container.append(canvas);
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  const program = gl && link(gl);
  if (!program) return { destroy: () => canvas.remove() };
  const u = program.uniforms;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Colours as OKLCH, so the ramp blends the way eyes see.
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const parse = (value) => {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  };
  const palette = new Float32Array(MAX_STOPS * 3);
  unwrapHues(s.stops.map((value) => toOklch(parse(value)))).forEach((stop, index) => palette.set(stop, index * 3));

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1 };
  const pointer = { x: 0, y: 0, inside: false };
  const state = { clock: 0, px: 0, py: 0.5, reach: 0, reveal: reduce ? 1 : 0 };
  let raf = 0;
  let last = 0;

  const render = () => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program.program);
    gl.bindVertexArray(vao);
    gl.uniform2f(u.uResolution, canvas.width, canvas.height);
    gl.uniform1f(u.uTime, state.clock);
    gl.uniform3fv(u.uStops, palette);
    gl.uniform1i(u.uStopCount, s.stops.length);
    gl.uniform1f(u.uAmplitude, s.amplitude);
    gl.uniform1f(u.uBlend, s.blend);
    gl.uniform1f(u.uHeight, s.height);
    gl.uniform1f(u.uScale, s.scale);
    gl.uniform1f(u.uGlow, s.glow);
    gl.uniform1f(u.uBrightness, s.brightness);
    gl.uniform1i(u.uLayers, s.layers);
    gl.uniform1f(u.uFlip, s.flip);
    gl.uniform3f(u.uPointer, state.px, state.py, state.reach);
    gl.uniform1f(u.uReveal, 1 - Math.pow(1 - state.reveal, 3));
    gl.uniform1f(u.uOpacity, s.opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const frame = (now) => {
    raf = 0;
    if (document.hidden) return;
    const dt = last ? clamp((now - last) / 1000, 0.0005, 0.05) : 1 / 60;
    last = now;
    state.clock += dt * s.speed * (reduce ? 0 : 1);
    const engaged = pointer.inside && !reduce;
    const follow = 1 - Math.exp(-dt / 0.6);
    if (engaged) {
      state.px += ((pointer.x - view.width / 2) / view.height - state.px) * follow;
      state.py += ((s.flip ? 1 - pointer.y / view.height : pointer.y / view.height) - state.py) * follow;
    }
    state.reach += ((engaged ? 1 : 0) - state.reach) * (1 - Math.exp(-dt / (engaged ? 0.9 : 1.4)));
    if (state.reveal < 1) state.reveal = Math.min(1, state.reveal + dt / INTRO_SECONDS);
    render();
    raf = requestAnimationFrame(frame);
  };
  const wake = () => !raf && !document.hidden && (raf = requestAnimationFrame(frame));
  const resize = () => {
    view.width = Math.max(1, container.clientWidth);
    view.height = Math.max(1, container.clientHeight);
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(view.width * ratio);
    canvas.height = Math.round(view.height * ratio);
    render();
    wake();
  };
  const onMove = (event) => {
    const rect = container.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
    wake();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  addEventListener("pointermove", onMove, { passive: true });
  const onVisible = () => ((last = 0), wake());
  document.addEventListener("visibilitychange", onVisible);
  resize();
  return {
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisible);
      canvas.remove();
    },
  };
}
