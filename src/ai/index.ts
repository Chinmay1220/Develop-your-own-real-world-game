// Chooses the Meta models when an API key is set, and the offline stand-ins otherwise.
import { config } from "../config.ts";
import { createMetaAi, createMetaDesigner, createMetaListener, MetaClient } from "./meta.ts";
import { createOfflineAi, offlineDesigner } from "./offline.ts";
import type { AiSet, Designer, Listener } from "./types.ts";

export function createAi(mode: string = config.aiMode): AiSet {
  const offline = createOfflineAi();
  if (mode !== "meta") return offline;
  if (!config.apiKey) throw new Error("AI_MODE is meta, but MODEL_API_KEY is not set");
  return withFallback(createMetaAi(new MetaClient(config.apiKey, config.baseUrl), config.models), offline);
}

/** Speech to text. There is no offline stand-in, so without a key there is no voice input. */
export function createListener(mode: string = config.aiMode): Listener | null {
  if (mode !== "meta" || !config.apiKey) return null;
  return createMetaListener(new MetaClient(config.apiKey, config.baseUrl), config.models.voice);
}

/** The level designer. It has no fallback: the museum example in place of the player's idea would mislead. */
export function createDesigner(mode: string = config.aiMode): Designer {
  if (mode !== "meta") return offlineDesigner;
  if (!config.apiKey) throw new Error("AI_MODE is meta, but MODEL_API_KEY is not set");
  return createMetaDesigner(new MetaClient(config.apiKey, config.baseUrl), config.models.designer);
}

/** When a Meta call fails, the offline stand-in handles that call so the game keeps going, and the failure is reported. */
function withFallback(primary: AiSet, backup: AiSet): AiSet {
  const warnings: string[] = [];
  async function attempt<T>(role: string, run: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      warnings.push(`${role} call failed (${(error as Error).message}). The offline stand-in handled it.`);
      return fallback();
    }
  }
  return {
    ...primary,
    world: {
      resolve: (state, actions, lessons) =>
        attempt("World model", () => primary.world.resolve(state, actions, lessons), () => backup.world.resolve(state, actions, lessons)),
    },
    guards: { decide: (input) => attempt("Guard", () => primary.guards.decide(input), () => backup.guards.decide(input)) },
    reflector: { reflect: (review) => attempt("Reflector", () => primary.reflector.reflect(review), () => backup.reflector.reflect(review)) },
    teacher: { review: (review) => attempt("Teacher", () => primary.teacher.review(review), () => backup.teacher.review(review)) },
    takeWarnings: () => warnings.splice(0),
  };
}
