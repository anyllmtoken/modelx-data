import { fetchText } from "./parse.ts";
import {
  type ModelEntry,
  readSources,
  runGenerate,
  setRegion,
  upsertWithSnapshot,
  inferModelType,
} from "./shared.ts";

setRegion("cn");

interface PriceRow {
  model: string;
  input: number;
  output: number;
  cache_read?: number;
  context?: number;
}

function parsePrice(price: string): number {
  const m = price.match(/¥([\d.]+)/);
  return m ? Number(m[1]) : 0;
}

function parseContext(ctx: string): number | undefined {
  const m = ctx.match(/([\d,]+)/);
  if (!m) return undefined;
  return Number(m[1].replace(/,/g, ""));
}

/** Extract rows from DocTable JSX in the .md page. */
function extractRows(md: string): string[][] {
  const rowsMatch = md.match(/rows=\{\[([\s\S]*?)\]\s*\}/);
  if (!rowsMatch) return [];

  const body = rowsMatch[1];
  const rows: string[][] = [];
  const rowRegex = /\[([^\]]*?)\]/g;
  let m;
  while ((m = rowRegex.exec(body)) !== null) {
    const cells = [...m[1].matchAll(/"([^"]*)"/g)].map((c) => c[1]);
    if (cells.length >= 4) rows.push(cells);
  }
  return rows;
}

async function fetchPricing(
  path: string,
  hasCache: boolean,
): Promise<PriceRow[]> {
  const md = await fetchText(
    `https://platform.kimi.com/docs/pricing/${path}.md`,
  );
  const rows = extractRows(md);
  return rows.map((r) => ({
    model: r[0],
    input: parsePrice(hasCache ? r[3] : r[2]),
    output: parsePrice(hasCache ? r[4] : r[3]),
    cache_read: hasCache ? parsePrice(r[2]) : undefined,
    context: parseContext(hasCache ? r[5] : r[4]),
  }));
}

async function main() {
  console.log("Fetching Moonshot / Kimi models with CNY pricing...");

  const [k27, k26, v1] = await Promise.all([
    fetchPricing("chat-k27-code", true),
    fetchPricing("chat-k26", true),
    fetchPricing("chat-v1", false),
  ]);

  console.log(`K2.7 Code: ${k27.length}, K2.6: ${k26.length}, V1: ${v1.length}`);

  const allRows = [...k27, ...k26, ...v1];
  let written = 0;

  for (const r of allRows) {
    const isVision = r.model.includes("vision");
    const isReasoning =
      r.model.includes("kimi-k2.7") || r.model.includes("kimi-k2.6");

    const pricing: Record<string, unknown> = {};
    pricing.input = r.input;
    pricing.output = r.output;
    if (r.cache_read != null) pricing.cached_input = r.cache_read;

    const entry: ModelEntry = {
      id: r.model,
      name: r.model,
      created_by: "moonshot",
      family: r.model.includes("kimi") ? "kimi" : "moonshot",
      model_type: inferModelType(r.model) ?? "chat",
      context_window: r.context,
      pricing,
      capabilities: {
        streaming: true,
        tool_call: true,
        structured_output: true,
        ...(isReasoning ? { reasoning: true } : {}),
      },
      modalities: {
        input: isVision ? ["text", "image"] : ["text"],
        output: ["text"],
      },
    };
    if (isReasoning) entry.reasoning_tokens = true;

    written += upsertWithSnapshot("moonshot", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
