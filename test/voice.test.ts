import assert from "node:assert/strict";
import { test } from "node:test";
import { readWav } from "../src/voice.ts";

/** A silent WAV clip with the given format. */
function wav({ seconds = 1, rate = 16000, channels = 1, bits = 16 } = {}): Uint8Array {
  const size = Math.round(seconds * rate) * channels * (bits / 8);
  const view = new DataView(new ArrayBuffer(44 + size));
  const write = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + size, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * (bits / 8), true);
  view.setUint16(32, channels * (bits / 8), true);
  view.setUint16(34, bits, true);
  write(36, "data");
  view.setUint32(40, size, true);
  return new Uint8Array(view.buffer);
}

test("a mono 16-bit clip at 16 or 24 kHz is accepted, with its length", () => {
  assert.deepEqual(readWav(wav({ seconds: 2.5 })), { sampleRate: 16000, seconds: 2.5 });
  assert.deepEqual(readWav(wav({ seconds: 1, rate: 24000 })), { sampleRate: 24000, seconds: 1 });
});

test("other recordings are refused with a reason, before anything is sent to Meta", () => {
  assert.match(String(readWav(wav({ channels: 2 }))), /mono, 16-bit/);
  assert.match(String(readWav(wav({ rate: 44100 }))), /16 or 24 kHz/);
  assert.match(String(readWav(new TextEncoder().encode("this is not a sound file at all, just some text"))), /not a WAV file/);
});
