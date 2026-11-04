// Settings come from environment variables, read from a .env file when one exists.
import { resolve } from "node:path";

try {
  process.loadEnvFile();
} catch {
  // No .env file: fall back to the defaults below.
}

export const ROOT = resolve(import.meta.dirname, "..");

const apiKey = process.env.MODEL_API_KEY?.trim() ?? "";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  apiKey,
  aiMode: process.env.AI_MODE === "offline" || !apiKey ? "offline" : "meta",
  baseUrl: process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1",
  roomFile: process.env.ROOM ?? "rooms/sample-bedroom.json",
  models: {
    world: process.env.MODEL_WORLD ?? "muse-spark-1.3",
    guards: process.env.MODEL_GUARDS ?? "muse-spark-1.3",
    reflector: process.env.MODEL_REFLECTOR ?? "muse-spark-1.3",
    teacher: process.env.MODEL_TEACHER ?? "muse-wonder-1.0",
    designer: process.env.MODEL_DESIGNER ?? "muse-spark-1.3",
    voice: process.env.MODEL_VOICE ?? "muse-voice-transcribe-1.0",
    writer: process.env.MODEL_WRITER ?? "muse-wonder-1.0",
    reviewer: process.env.MODEL_REVIEWER ?? "muse-wonder-1.0",
    engine: process.env.MODEL_ENGINE ?? "muse-spark-1.3", // No Engine: keeps the world's facts and decides each move
    painter: process.env.MODEL_PAINTER ?? "muse-image-1.0", // No Engine: paints every frame
  },
  /** The most No Engine may spend in one run of the server, in US dollars. */
  paintBudgetUsd: Number(process.env.PAINT_BUDGET_USD ?? 3),
  /** The most Meta's AI inside running games may spend in one run of the server, in US dollars. */
  liveBudgetUsd: Number(process.env.LIVE_BUDGET_USD ?? 2),
};

/** US dollars per hour of audio, from dev.meta.ai/docs/speech-to-text on 2026-10-29. Billed in whole seconds. */
export const AUDIO_PRICES: Record<string, number> = {
  "muse-voice-transcribe-1.0": 0.18,
};

/** US dollars per image, from dev.meta.ai/docs/pricing-rate-limits on 2026-10-27. */
export const IMAGE_PRICES: Record<string, number> = {
  "muse-image-1.0": 0.01,
};

/** US dollars per million tokens, from dev.meta.ai/docs/pricing-rate-limits on 2026-10-27. */
export const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "muse-wonder-1.0": { input: 4, cached: 0.2, output: 20 },
  "muse-spark-1.3": { input: 1.25, cached: 0.15, output: 4.25 },
  "muse-spark-1.2": { input: 1.25, cached: 0.15, output: 4.25 },
  "muse-spark-1.1": { input: 1.25, cached: 0.15, output: 4.25 },
  "muse-spark-1.3-contributor": { input: 0.1, cached: 0.002, output: 0.2 },
  "muse-spark-1.2-contributor": { input: 0.1, cached: 0.002, output: 0.2 },
};
