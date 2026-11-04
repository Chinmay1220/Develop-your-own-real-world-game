// Checks a recorded clip before it goes to Meta's speech-to-text model, which takes WAV files of
// mono, 16-bit PCM at 16 or 24 kHz, up to 10 minutes long.

export interface WavInfo {
  sampleRate: number;
  seconds: number;
}

/** Reads the WAV header. Returns what is wrong with the clip as a sentence, or its length. */
export function readWav(bytes: Uint8Array): WavInfo | string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return "The recording is not a WAV file";
  let format: { pcm: number; channels: number; sampleRate: number; bits: number } | null = null;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      format = { pcm: view.getUint16(offset + 8, true), channels: view.getUint16(offset + 10, true), sampleRate: view.getUint32(offset + 12, true), bits: view.getUint16(offset + 22, true) };
    }
    if (id === "data") {
      if (!format) return "The WAV file has no format description before its sound";
      if (format.pcm !== 1 || format.channels !== 1 || format.bits !== 16 || ![16000, 24000].includes(format.sampleRate)) {
        return "The recording must be mono, 16-bit, at 16 or 24 kHz";
      }
      const sound = Math.min(size, bytes.length - offset - 8);
      return { sampleRate: format.sampleRate, seconds: sound / (format.sampleRate * 2) };
    }
    offset += 8 + size + (size % 2); // chunks are padded to an even length
  }
  return "The WAV file has no sound in it";
}
