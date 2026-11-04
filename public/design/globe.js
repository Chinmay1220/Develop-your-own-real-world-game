// A turning globe with glowing markers, drawn by COBE by Shu Ding (github.com/shuding/cobe, MIT),
// loaded from jsDelivr. Drag to turn it; focus(lat, lon) swings it to a place.
import createGlobe from "https://cdn.jsdelivr.net/npm/cobe@0.6.4/+esm";

const TAU = Math.PI * 2;
/** COBE's angles for a place, so that it faces the viewer. */
const anglesOf = ([lat, lon]) => [Math.PI - ((lon * Math.PI) / 180 - Math.PI / 2), (lat * Math.PI) / 180];

export function globe(canvas, { markers = [], dark = 1, baseColor = [0.22, 0.2, 0.18], markerColor = [1, 0.72, 0.26], glowColor = [0.9, 0.55, 0.2] } = {}) {
  let phi = 0;
  let theta = 0.25;
  let target = null; // [phi, theta] to swing to
  let dragging = null;
  let spin = 0.0022;
  let size = canvas.offsetWidth;
  let markersChanged = false;
  const instance = createGlobe(canvas, {
    devicePixelRatio: 2,
    width: size * 2,
    height: size * 2,
    phi,
    theta,
    dark,
    diffuse: 1.25,
    mapSamples: 16000,
    mapBrightness: 5.5,
    baseColor,
    markerColor,
    glowColor,
    markers,
    onRender(state) {
      if (target) {
        // The shortest way round, eased.
        let delta = ((target[0] - phi) % TAU + TAU * 1.5) % TAU - TAU / 2;
        phi += delta * 0.08;
        theta += (target[1] - theta) * 0.08;
        if (Math.abs(delta) < 0.002 && Math.abs(target[1] - theta) < 0.002) target = null;
      } else if (!dragging) phi += spin;
      state.phi = phi;
      state.theta = theta;
      state.width = size * 2;
      state.height = size * 2;
      if (markersChanged) (state.markers = markers), (markersChanged = false);
    },
  });
  canvas.style.cursor = "grab";
  canvas.addEventListener("pointerdown", (event) => {
    dragging = { x: event.clientX, y: event.clientY, phi, theta };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
    target = null;
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    phi = dragging.phi + (event.clientX - dragging.x) / 160;
    theta = Math.max(-0.9, Math.min(0.9, dragging.theta + (event.clientY - dragging.y) / 260));
  });
  canvas.addEventListener("pointerup", () => ((dragging = null), (canvas.style.cursor = "grab")));
  new ResizeObserver(() => (size = canvas.offsetWidth)).observe(canvas);
  return {
    /** Turns the globe to a place and makes its marker stand out. */
    focus(location) {
      target = anglesOf(location);
      markers = markers.map((marker) => ({ ...marker, size: marker.location === location ? 0.09 : 0.04 }));
      markersChanged = true;
    },
    destroy: () => instance.destroy(),
  };
}
