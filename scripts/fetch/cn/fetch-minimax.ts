import { fetchText } from "./parse.ts";
import {
  type ModelEntry,
  runGenerate,
  setRegion,
  upsertWithSnapshot,
  inferModelType,
  inferFamily,
} from "./shared.ts";

setRegion("cn");

interface PriceDef {
  id: string;
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

async function main() {
  console.log("Fetching MiniMax models with CNY pricing...");

  const md = await fetchText(
    "https://platform.minimaxi.com/docs/guides/pricing-paygo.md",
  );

  // Parse markdown tables: extract model name and prices
  // Pattern: | **MiniMax-xxx** | price | price | price |
  const models: PriceDef[] = [];
  const lineRegex =
    /\|\s*\*\*([^*]+)\*\*(?:<br\s*\/?>[^|]*)?\s*\|\s*(?:~~[\d.]+~~\s*)?([\d.]+)\s*\|\s*(?:~~[\d.]+~~\s*)?([\d.]+)\s*\|\s*(?:~~[\d.]+~~\s*)?([\d.]+)/g;

  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(md)) !== null) {
    const name = m[1].trim();
    // Skip non-language models (video/audio/image)
    if (
      name.includes("Hailuo") ||
      name.includes("speech") ||
      name.includes("Music") ||
      name.includes("image") ||
      name.includes("API-vlm") ||
      name.includes("web_search") ||
      name.includes("Voice") ||
      name.includes("voice")
    )
      continue;

    const input = Number(m[2]);
    const output = Number(m[3]);
    const cache = Number(m[4]);

    // Clean model ID
    const id = name
      .toLowerCase()
      .replace(/[\(\)]/g, "")
      .replace(/\s+/g, "-")
      .replace(/^minimax--/, "minimax-");

    // Skip duplicate M3 entries (standard + priority, both tiers)
    if (models.some((x) => x.id === id)) continue;

    models.push({ id, input, output, cache_read: cache });
  }

  // Also parse cache_write column (only M2.7+ tables have it)
  const writeRegex =
    /\|\s*\*\*([^*]+)\*\*(?:<br\s*\/?>[^|]*)?\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/g;
  while ((m = writeRegex.exec(md)) !== null) {
    const name = m[1].trim();
    if (name.includes("MiniMax")) {
      const id = name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/^minimax--/, "minimax-");
      const cachedModel = models.find((x) => x.id === id);
      if (cachedModel) {
        cachedModel.cache_write = Number(m[5]);
      }
    }
  }

  console.log(`Parsed ${models.length} language models`);

  let written = 0;
  for (const r of models) {
    const isHighspeed = r.id.includes("highspeed");

    const pricing: Record<string, unknown> = {
      input: r.input,
      output: r.output,
    };
    if (r.cache_read != null) pricing.cached_input = r.cache_read;
    if (r.cache_write != null) pricing.cache_write = r.cache_write;

    const entry: ModelEntry = {
      id: r.id,
      name: r.id,
      created_by: "minimax",
      family: inferFamily(r.id) ?? "minimax",
      model_type: inferModelType(r.id) ?? "chat",
      pricing,
      capabilities: {
        streaming: true,
        tool_call: true,
        structured_output: true,
      },
      modalities: { input: ["text"], output: ["text"] },
    };

    written += upsertWithSnapshot("minimax", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
