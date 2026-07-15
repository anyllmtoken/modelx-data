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

// Source: https://platform.baichuan-ai.com/prices
// Table: 计费项 | 上下文长度 | 时间 | 价格 | 备注
// Prices in 元/千tokens (×1000 → 元/百万tokens)

async function main() {
  console.log("Fetching Baichuan model pricing...");

  const html = await fetch("https://platform.baichuan-ai.com/prices", {
    headers: { "User-Agent": "Mozilla/5.0" },
  }).then((r) => r.text());

  const $ = cheerio.load(html);
  const models: { id: string; input: number; output: number }[] = [];
  const seen = new Set<string>();

  $("table").each((_, table) => {
    $(table).find("tr").each((ri, row) => {
      if (ri === 0) return;
      const cells = $(row).find("td").toArray();
      const texts = cells.map((c) => $(c).text().trim());

      const nameMatch = texts[0]?.match(/模型调用\s+(\S+)/);
      if (!nameMatch) return;
      const name = nameMatch[1];
      const id = name.toLowerCase();
      if (seen.has(id)) return;
      seen.add(id);

      const priceCol = texts[3] || texts[2] || "";
      let input = 0, output = 0;

      // Split pricing: "输入：0.005元/千tokens输出：0.009元/千tokens"
      const inMatch = priceCol.match(/输入[：:]\s*([\d.]+)/);
      const outMatch = priceCol.match(/输出[：:]\s*([\d.]+)/);
      if (inMatch && outMatch) {
        input = parseFloat(inMatch[1]) * 1000;
        output = parseFloat(outMatch[1]) * 1000;
      } else {
        // Combined pricing: "0.015元/千tokens"
        const combined = priceCol.match(/([\d.]+)/);
        if (combined) input = parseFloat(combined[1]) * 1000;
      }

      if (input === 0 && output === 0) return;

      models.push({ id, input, output });
    });
  });

  console.log(`Found ${models.length} models`);

  let written = 0;
  for (const m of models) {
    const capabilities: Record<string, boolean> = { streaming: true, tool_call: true, structured_output: true };
    const entry: ModelEntry = {
      id: m.id,
      name: m.id,
      created_by: "baichuan",
      family: inferFamily(m.id) ?? "baichuan",
      model_type: inferModelType(m.id) ?? "chat",
      pricing: { input: m.input, ...(m.output > 0 ? { output: m.output } : {}) },
      capabilities,
      modalities: { input: ["text"], output: ["text"] },
    };
    written += upsertWithSnapshot("baichuan", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
