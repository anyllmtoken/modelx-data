import * as cheerio from "cheerio";
import {
  type ModelEntry,
  runGenerate,
  setRegion,
  upsertWithSnapshot,
  inferModelType,
  inferFamily,
} from "./shared.ts";

setRegion("cn");

async function main() {
  console.log("Fetching ZeroOne (Yi) model pricing...");

  const html = await fetch("https://platform.lingyiwanwu.com/docs", {
    headers: { "User-Agent": "Mozilla/5.0" },
  }).then((r) => r.text());

  // Extract the RSC payload (self.__next_f.push), decode and parse
  // The data is in format: self.__next_f.push([1,"...json...]);
  // Inside the JSON, find rows like: ["$","tr",null,{"children":[[...model td...],[...],["$","td",null,{"children":"¥0.99"}]}]}
  const models: { id: string; price: number; context: number; vision: boolean }[] = [];
  const seen = new Set<string>();

  // Find all RSC payloads and concatenate
  const rscBlocks: string[] = [];
  const rscRegex = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let rscMatch: RegExpExecArray | null;
  let fullPayload = "";

  while ((rscMatch = rscRegex.exec(html)) !== null) {
    try {
      fullPayload += JSON.parse(`"${rscMatch[1]}"`) as string;
    } catch {}
  }

  if (!fullPayload) {
    // Fallback: try direct regex for pricing table
    const tableRegex = /tr\\\",null,\{[\s\S]*?children\\\":\\\"(yi-[\w-]+)\\\"[\s\S]*?children\\\":\\\"¥([\d.]+)\\\"/g;
    while ((rscMatch = tableRegex.exec(html)) !== null) {
      const id = rscMatch[1].toLowerCase();
      const price = parseFloat(rscMatch[2]);
      if (id && !seen.has(id)) {
        seen.add(id);
        models.push({ id, price, context: 16384, vision: id.includes("vision") });
      }
    }
  }

  // Try fallback 2: parse from the JSON structure directly
  if (models.length === 0) {
    // Search for yi-lightning followed by ¥0.99 in the raw HTML
    const lightningMatch = html.match(/yi-lightning[\s\S]{0,500}¥([\d.]+)/);
    const visionMatch = html.match(/yi-vision-v2[\s\S]{0,500}¥([\d.]+)/);
    if (lightningMatch) models.push({ id: "yi-lightning", price: parseFloat(lightningMatch[1]), context: 16384, vision: false });
    if (visionMatch) models.push({ id: "yi-vision-v2", price: parseFloat(visionMatch[1]), context: 16384, vision: true });
  }

  console.log(`Found ${models.length} models`);

  let written = 0;
  for (const m of models) {
    const capabilities: Record<string, boolean> = { streaming: true, tool_call: true, structured_output: true };
    const modalities: { input: string[]; output: string[] } = { input: ["text"], output: ["text"] };
    if (m.vision) modalities.input.push("image");

    const entry: ModelEntry = {
      id: m.id,
      name: m.id,
      created_by: "zeroone",
      family: inferFamily(m.id) ?? "yi",
      model_type: inferModelType(m.id) ?? "chat",
      context_window: m.context,
      pricing: { input: m.price },
      capabilities,
      modalities,
    };
    written += upsertWithSnapshot("zeroone", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
