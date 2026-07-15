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

const CREATOR_MAP: Record<string, string> = {
  "360zhinao": "ai360",
  "openai": "openai",
  "deepseek": "deepseek",
  "moonshot": "moonshot",
  "moonshotai": "moonshot",
  "bytedance": "bytedance",
  "z-ai": "zai",
  "minimax": "minimax",
  "alibaba": "qwen",
  "qwen": "qwen",
  "stepfun": "stepfun",
  "xiaomi": "xiaomi",
  "anthropic": "anthropic",
  "google": "google",
  "meta": "meta",
  "amazon": "amazon",
};

function mapCreator(rawId: string): string {
  const prefix = rawId.split("/")[0];
  return CREATOR_MAP[prefix] ?? prefix;
}

async function main() {
  console.log("Fetching ai.360.com model pricing...");

  // Collect model IDs across all pages (size=100 per page)
  const modelIds = new Set<string>();
  let page = 1;
  let allBodyText = "";

  while (true) {
    const url = `https://ai.360.com/open/zh/models?size=100&page=${page}`;
    const html = await fetch(url).then((r) => r.text());
    const $ = cheerio.load(html);
    allBodyText += $("body").text();

    let pageCount = 0;
    $('a[href*="?model="]').each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const m = href.match(/[?&]model=([^&]+)/);
      if (m) {
        const id = decodeURIComponent(m[1]).toLowerCase();
        if (!modelIds.has(id)) {
          modelIds.add(id);
          pageCount++;
        }
      }
    });

    console.log(`  page ${page}: +${pageCount} new models`);
    if (pageCount === 0) break;
    page++;
  }

  console.log(`Found ${modelIds.size} model IDs from all pages`);

  // Extract pricing for each model from the concatenated body text
  const models: { id: string; input: number; output: number; context: number; creator: string }[] = [];

  for (const id of modelIds) {
    const idx = allBodyText.indexOf(id);
    if (idx < 0) continue;

    const cardText = allBodyText.substring(idx, idx + 800);
    const pMatch = cardText.match(
      /输入价格:¥([\d.]+)\s*\/\s*1M\s*tokens[\s\S]{0,100}?输出价格:¥([\d.]+)\s*\/\s*1M\s*tokens[\s\S]{0,100}?上下文:([\d,]+)/,
    );
    if (!pMatch) continue;

    const input = parseFloat(pMatch[1]);
    const output = parseFloat(pMatch[2]);
    const context = parseInt(pMatch[3].replace(/,/g, ""), 10);
    if (isNaN(input) || isNaN(output)) continue;

    models.push({ id, input, output, context: isNaN(context) ? 0 : context, creator: mapCreator(id) });
  }

  console.log(`Parsed ${models.length} models with pricing`);

  let written = 0;
  for (const spec of models) {
    const capabilities: Record<string, boolean> = {
      streaming: true,
      tool_call: true,
      structured_output: true,
    };

    const entry: ModelEntry = {
      id: spec.id,
      name: spec.id,
      created_by: spec.creator,
      family: inferFamily(spec.id) ?? "ai360",
      model_type: inferModelType(spec.id) ?? "chat",
      context_window: spec.context > 0 ? spec.context : undefined,
      pricing: { input: spec.input, output: spec.output },
      capabilities,
      modalities: { input: ["text"], output: ["text"] },
    };

    written += upsertWithSnapshot("ai360", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
