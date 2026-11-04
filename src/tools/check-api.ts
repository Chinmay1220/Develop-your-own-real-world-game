// Checks that your Meta Model API key works: lists your models, then makes one tiny test call.
// Run with: npm run api:check (the test call costs a fraction of a cent)
import { MetaClient, strictObject } from "../ai/meta.ts";
import { config } from "../config.ts";

if (!config.apiKey) {
  console.error("MODEL_API_KEY is not set. Copy .env.example to .env and put your key after MODEL_API_KEY=");
  process.exit(1);
}

const client = new MetaClient(config.apiKey, config.baseUrl);
try {
  const available = await client.listModels();
  console.log(`Your key works. ${available.length} models are available to you.`);
  for (const [role, model] of Object.entries(config.models)) {
    console.log(`  ${role.padEnd(10)} ${model.padEnd(18)} ${available.includes(model) ? "available" : "NOT in your model list"}`);
  }
  const schema = strictObject({ ok: { type: "boolean" } });
  const reply = await client.json<{ ok: boolean }>(config.models.world, "Reply with ok set to true.", { ping: true }, "Ping", schema, "minimal");
  console.log(`Test call to ${config.models.world} replied ${JSON.stringify(reply)}. Cost: about $${client.usage().usd.toFixed(5)}.`);
} catch (error) {
  console.error(`The API check failed: ${(error as Error).message}`);
  process.exit(1);
}
