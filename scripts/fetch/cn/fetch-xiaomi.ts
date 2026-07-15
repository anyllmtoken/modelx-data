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
  cache_read: number;
  model_type?: string;
  modalities?: Record<string, string[]>;
}

async function main() {
  console.log("Fetching Xiaomi MiMo models with CNY pricing...");

  const md = await fetchText(
    "https://platform.xiaomimimo.com/static/docs/price/pay-as-you-go.md",
  );

  // Parse domestic pricing tables: extract model IDs and prices
  // The markdown uses JSX elements like <p className=...>¥X.XX</p>
  // Look for domestic section first, then extract row by row
  const models: PriceDef[] = [];
  const seen = new Set<string>();

  // Split by domestic/overseas sections
  const domesticSection = md.split("### Overseas")[0];
  if (!domesticSection) throw new Error("Could not find domestic pricing section");

  // Find all table rows in domestic section
  const lines = domesticSection.split("\n");
  let currentId = "";
  let currentPrices: string[] = [];

  for (const line of lines) {
    // Check for model ID in backticks
    const idMatch = line.match(/`([^`]+)`/);
    if (idMatch) {
      currentId = idMatch[1];
      currentPrices = [];
      continue;
    }
    // Check for ¥ price
    if (currentId && line.includes("¥")) {
      const priceMatch = line.match(/¥([\d.]+)/);
      if (priceMatch) {
        currentPrices.push(priceMatch[1]);
        // When we have 3 prices (cache_hit, input, output) for non-ASR models
        // or 1 price for ASR models
        if (currentPrices.length === 3 && !currentId.includes("asr")) {
          if (!seen.has(currentId)) {
            seen.add(currentId);
            models.push({
              id: currentId,
              input: Number(currentPrices[1]),
              output: Number(currentPrices[2]),
              cache_read: Number(currentPrices[0]),
            });
          }
          currentId = "";
          currentPrices = [];
        }
      }
    }
  }

  // ASR pricing
  const asrMatch = md.match(/`(mimo-v2\.5-asr)`[^|]*?¥([\d.]+)\s*\/h/);
  if (asrMatch) {
    models.push({
      id: asrMatch[1],
      input: Number(asrMatch[2]),
      output: 0,
      cache_read: 0,
      model_type: "transcription",
      modalities: { input: ["audio"], output: ["text"] },
    });
  }

  // TTS models - free for limited time
  for (const ttsId of [
    "mimo-v2.5-tts",
    "mimo-v2.5-tts-voiceclone",
    "mimo-v2.5-tts-voicedesign",
    "mimo-v2-tts",
  ]) {
    if (!models.find((x) => x.id === ttsId)) {
      models.push({
        id: ttsId,
        input: 0,
        output: 0,
        cache_read: 0,
        model_type: "tts",
        modalities: { input: ["text"], output: ["audio"] },
      });
    }
  }

  console.log(`Parsed ${models.length} models`);

  let written = 0;
  for (const r of models) {
    const pricing: Record<string, unknown> = {};
    if (r.model_type === "transcription") {
      pricing.audio_duration = r.input; // ¥0.5/h
    } else if (r.model_type === "tts") {
      // Free, no pricing needed
    } else {
      pricing.input = r.input;
      pricing.output = r.output;
      pricing.cached_input = r.cache_read;
    }

    const entry: ModelEntry = {
      id: r.id,
      name: r.id,
      created_by: "xiaomi",
      family: inferFamily(r.id) ?? "mimo",
      model_type: (r.model_type ?? inferModelType(r.id) ?? "chat") as ModelEntry["model_type"],
      pricing: Object.keys(pricing).length > 0 ? pricing : undefined,
      capabilities: { streaming: true },
      modalities: r.modalities ?? { input: ["text"], output: ["text"] },
    };

    written += upsertWithSnapshot("xiaomi", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
