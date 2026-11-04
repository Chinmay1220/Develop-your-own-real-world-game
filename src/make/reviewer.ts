// The reviewer: Meta's model looks at screenshots of a freshly written game and says what a player
// would see is wrong, such as a missing track or a black screen. Errors are caught by the test;
// this catches games that run but look wrong. Its problems go back to the writer.
import { MetaClient, strictObject } from "../ai/meta.ts";
import type { UsageReport } from "../ai/types.ts";
import { config } from "../config.ts";

export interface GameReviewer {
  model: string;
  review(request: { prompt: string; title: string; controls: string; views: string[] }): Promise<string[]>;
  usage(): UsageReport | null;
}

const INSTRUCTIONS = `You check games that an AI wrote from a player's request, by looking at screenshots from an automatic test.
The first screenshot is just after the game started. The second is after a few seconds of the test pressing arrow keys, WASD and Space and clicking, without aiming, so the player may have wandered off course or crashed. That is the test's driving, not a problem with the game.

List only clear, important problems a player would notice at once:
- something the request asked for that should be visible but isn't, such as a missing track, road, ground, player character or level;
- broken pictures: a black or empty screen, the view blocked by something huge, the camera inside an object or looking at nothing, text covering the action;
- the wrong kind of game for the request.
Don't list small style choices, missing details that are hard to judge from a still picture, or things that only show up later in play.
Write each problem as one short sentence that says what to fix. Return an empty list if the game looks right.`;

const REVIEW_SCHEMA = strictObject({ problems: { type: "array", items: { type: "string" } } });

export function createMetaReviewer(client: MetaClient, model: string): GameReviewer {
  return {
    model,
    async review({ prompt, title, controls, views }) {
      const reply = await client.json<{ problems: string[] }>(model, INSTRUCTIONS, { request: prompt, title, controls }, "Review", REVIEW_SCHEMA, "low", { images: views, timeoutMs: 120_000 });
      return reply.problems.filter(Boolean).slice(0, 6);
    },
    usage: () => client.usage(),
  };
}

export function createReviewer(): GameReviewer | null {
  if (config.aiMode !== "meta" || !config.apiKey) return null;
  return createMetaReviewer(new MetaClient(config.apiKey, config.baseUrl), config.models.reviewer);
}
