import { renderZhipuPage } from "./render-zhipu.ts";
import * as cheerio from "cheerio";
import {
  type ModelEntry,
  runGenerate,
  setRegion,
  upsertWithSnapshot,
  inferFamily,
  inferModelType,
} from "./shared.ts";

setRegion("cn");

function parsePrice(s: string): number {
  const m = s.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function cleanName(s: string): string {
  return s.replace(/新品/g, "").trim().toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function main() {
  console.log("Fetching Zhipu (GLM) model pricing...");

  console.log("Rendering pricing page...");
  const html = await renderZhipuPage();
  console.log(`Got HTML: ${html.length} bytes`);

  const $ = cheerio.load(html);
  const models: { id: string; input: number; output: number; cache?: number }[] = [];
  const seen = new Set<string>();

  $("table").each((_, table) => {
    const firstCell = $(table).find("tr").first().find("td, th").first().text().trim();

    // Skip non-pricing tables
    if (!firstCell.startsWith("模型名称") && !firstCell.startsWith("GLM-") && !firstCell.startsWith("CogView") && !firstCell.startsWith("GLM-Image")) return;

    // Skip legacy/training/deploy tables
    const text = $(table).text();
    if (text.includes("算力单元") || text.includes("模型训练") || text.includes("模型推理") || text.includes("私有实例") || text.includes("批量API")) return;

    const rows = $(table).find("tr").toArray();
    let lastName = "";

    for (const row of rows) {
      const cells = $(row).find("td, th").toArray();
      if (cells.length < 3) continue;
      const tds = cells.map((c) => $(c).text().trim());

      const cell0 = tds[0] || "";

      // Detect model name
      if (cell0 === "模型名称") { lastName = ""; continue; }

      // Model name patterns
      if (/^(GLM|CogView|CogVideo|Embedding|CharGLM|CodeGeeX|Vidu|Rerank|Emohaa|Search)/.test(cell0)) {
        lastName = cell0.replace(/新品/g, "").trim();
      }

      if (!lastName || cell0.startsWith("输入长度") || cell0.includes("免费")) continue;

      const id = cleanName(lastName);
      if (seen.has(id)) continue;

      // Find input and output prices in the row
      let inp = 0, out = 0, cache = 0;
      let cacheStr = "";

      // Determine column layout based on cell count and content
      if (tds.length >= 6 && tds[2].includes("元")) {
        // Standard layout: name | context | input | output | cache_storage | cache_hit
        inp = parsePrice(tds[2]);
        out = parsePrice(tds[3]);
        cacheStr = tds[5] || "";
      } else if (tds.length >= 5 && tds[3].includes("元")) {
        // Legacy layout: name | desc | context | input | output
        inp = parsePrice(tds[3]);
        out = parsePrice(tds[4]);
      } else if (tds.length >= 4 && tds[2].includes("元")) {
        // Simple layout: name | desc | price | batch_price
        inp = parsePrice(tds[2]);
        out = inp;
      }

      if (inp === 0 && out === 0) continue;
      if (!cacheStr.includes("免费") && !cacheStr.includes("不支持")) cache = parsePrice(cacheStr);

      seen.add(id);
      models.push({ id, input: inp, output: out, cache: cache || undefined });
    }
  });

  console.log(`Found ${models.length} models`);

  let written = 0;
  for (const m of models) {
    const pricing: Record<string, unknown> = { input: m.input, output: m.output };
    if (m.cache) pricing.cached_input = m.cache;

    const entry: ModelEntry = {
      id: m.id,
      name: m.id,
      created_by: "zai",
      family: inferFamily(m.id) ?? "glm",
      model_type: inferModelType(m.id) ?? "chat",
      pricing,
      capabilities: { streaming: true, tool_call: true, structured_output: true },
      modalities: { input: ["text"], output: ["text"] },
    };
    written += upsertWithSnapshot("zai", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => { console.error(err); process.exit(1); });
