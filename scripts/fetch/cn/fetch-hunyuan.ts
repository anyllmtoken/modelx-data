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

// Source: https://cloud.tencent.com/document/product/1823/130055
// Prices in CNY/百万tokens unless noted.

function extractLlmTable($: cheerio.CheerioAPI): { id: string; input: number; output: number; cache: number }[] {
  const tables = $("table").toArray();
  const results: { id: string; input: number; output: number; cache: number }[] = [];
  const seen = new Set<string>();

  for (const table of tables) {
    const header = $(table).find("tr").first().text();
    if (!header.includes("模型名称") || !header.includes("推理输入")) continue;

    const rows = $(table).find("tr").toArray();
    let lastName = "";

    for (let i = 1; i < rows.length; i++) {
      const cells = $(rows[i]).find("td, th").toArray();
      const texts = cells.map((c) => $(c).text().trim());

      const rawName = texts[0] || "";
      if (rawName && rawName !== "-" && !rawName.startsWith("输入") && !rawName.startsWith("输出")) {
        lastName = rawName;
      }
      if (!lastName) continue;

      // Skip table footer rows
      if (lastName.includes("模型名称")) continue;

      // Take only the model name (strip suffixes like "原厂直供", "（下线日期）")
      const cleanName = lastName
        .replace(/原厂直供/g, "")
        .replace(/（[^）]+）$/g, "")
        .replace(/\([^)]+\)$/g, "")
        .trim();
      if (!cleanName || cleanName === "-") continue;

      const id = cleanName.toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (seen.has(id)) continue;

      // Find column indices from header
      const hCells = $(table).find("tr").first().find("td, th").toArray().map((c) => $(c).text().trim());
      const inputIdx = hCells.findIndex((h) => h.includes("推理输入"));
      const outputIdx = hCells.findIndex((h) => h.includes("推理输出"));
      const cacheIdx = hCells.findIndex((h) => h.includes("缓存命中"));

      const parseP = (idx: number): number | null => {
        if (idx < 0 || idx >= texts.length) return null;
        const v = texts[idx].replace(/[^0-9.]/g, "");
        if (!v) return null;
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      };

      const inp = parseP(inputIdx);
      const out = parseP(outputIdx);
      const cache = parseP(cacheIdx);

      if (inp === null && out === null) continue;

      seen.add(id);
      results.push({
        id,
        input: inp ?? 0,
        output: out ?? 0,
        cache: cache ?? 0,
      });
    }
  }

  return results;
}

function extractMediaTable($: cheerio.CheerioAPI): { id: string; type: string; price: number }[] {
  const tables = $("table").toArray();
  const results: { id: string; type: string; price: number }[] = [];
  const seen = new Set<string>();

  for (const table of tables) {
    const html = $(table).html() ?? "";
    const isImage = html.includes("输出单价") && html.includes("元/张");
    const isVideo = html.includes("积分单价") && html.includes("视频");
    if (!isImage && !isVideo) continue;

    const rows = $(table).find("tr").toArray();

    for (let i = 1; i < rows.length; i++) {
      const cells = $(rows[i]).find("td, th").toArray();
      const texts = cells.map((c) => $(c).text().trim());
      const rawName = texts[0] || "";
      if (!rawName || rawName === "-" || rawName.includes("模型名称")) continue;

      const id = rawName.toLowerCase().replace(/\s+/g, "-").replace(/[()]/g, "");
      if (seen.has(id)) continue;

      // Find first numeric price in cells
      let price: number | null = null;
      for (let j = 1; j < texts.length; j++) {
        const m = texts[j].match(/(\d+\.?\d*)/);
        if (m) {
          const n = parseFloat(m[1]);
          if (n > 0) { price = n; break; }
        }
      }
      if (price === null) continue;

      seen.add(id);
      results.push({
        id,
        type: isImage ? "image" : "video",
        price,
      });
    }
  }

  return results;
}

async function main() {
  console.log("Fetching Tencent Hunyuan pricing...");

  const html = await fetch("https://cloud.tencent.com/document/product/1823/130055", {
    headers: { "User-Agent": "Mozilla/5.0" },
  }).then((r) => r.text());

  const $ = cheerio.load(html);

  const llmModels = extractLlmTable($);
  console.log(`Found ${llmModels.length} LLM models`);

  const mediaModels = extractMediaTable($);
  console.log(`Found ${mediaModels.length} media models`);

  let written = 0;

  for (const m of llmModels) {
    const pricing: Record<string, unknown> = { input: m.input, output: m.output };
    if (m.cache > 0) pricing.cached_input = m.cache;

    const entry: ModelEntry = {
      id: m.id,
      name: m.id,
      created_by: "tencent",
      family: inferFamily(m.id) ?? "hunyuan",
      model_type: inferModelType(m.id) ?? "chat",
      pricing,
      capabilities: { streaming: true, tool_call: true, structured_output: true },
      modalities: { input: ["text"], output: ["text"] },
    };
    written += upsertWithSnapshot("tencent", entry) ? 1 : 0;
  }

  for (const m of mediaModels) {
    const modelType = m.type === "image" ? "image" as const : "video" as const;
    const entry: ModelEntry = {
      id: m.id,
      name: m.id,
      created_by: "tencent",
      family: "hunyuan",
      model_type: modelType,
      pricing: { input: m.price },
      capabilities: { streaming: true },
      modalities: {
        input: ["text", "image"],
        output: m.type === "image" ? ["image"] : ["video"],
      },
    };
    written += upsertWithSnapshot("tencent", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
