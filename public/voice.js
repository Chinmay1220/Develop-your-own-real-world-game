// Records the player's voice for Meta's speech-to-text model, which takes WAV clips of mono 16-bit
// sound at 16 kHz. Browsers record in their own formats, so the clip is converted here.
// Recording stops by itself after a pause, so the player can just speak.

const RATE = 16000;
const SPEAKING = 0.02; // a sound level above this counts as speech

/**
 * Starts listening. `done` resolves with a WAV blob once the player pauses (or after `maxSeconds`);
 * `stop()` ends it early. `onLevel` gets the sound level about 20 times a second, for a meter.
 */
export function startRecording({ maxSeconds = 30, pauseSeconds = 1.6, onLevel = () => {} } = {}) {
  let stop = () => {};
  const done = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (event) => event.data.size > 0 && chunks.push(event.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));

    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    stop = () => recorder.state === "recording" && recorder.stop();
    recorder.start();
    const started = performance.now();
    let spoke = false;
    let quietSince = null;
    const meter = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const level = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      onLevel(level);
      const now = performance.now();
      if (level > SPEAKING) {
        spoke = true;
        quietSince = null;
      } else if (spoke) {
        quietSince ??= now;
      }
      if ((quietSince !== null && now - quietSince > pauseSeconds * 1000) || now - started > maxSeconds * 1000) stop();
    }, 50);

    await stopped;
    clearInterval(meter);
    for (const track of stream.getTracks()) track.stop();
    const recording = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer();
    const sound = await context.decodeAudioData(recording);
    await context.close();
    return { wav: toWav(await toMono16k(sound)), spoke };
  })();
  return { done, stop: () => stop() };
}

/** Mixes down to one channel and resamples to 16 kHz. */
async function toMono16k(sound) {
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(sound.duration * RATE)), RATE);
  const source = offline.createBufferSource();
  source.buffer = sound;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

/** A WAV file: a 44-byte header, then 16-bit samples. */
function toWav(samples) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const write = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true); // size of the format chunk
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample
  view.setUint16(34, 16, true); // bits per sample
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 0x7fff, true));
  return new Blob([view], { type: "audio/wav" });
}
