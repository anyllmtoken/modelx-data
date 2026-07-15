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

// Source: https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya
// Table cols: 模型名称 | 版本名称 | 服务内容 | 子项(input/output tag) | 在线推理(元/千tokens) | ...

async function main() {
  console.log("Fetching Baidu Qianfan pricing...");

  const html = await fetch("https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya", {
    headers: { "User-Agent": "Mozilla/5.0" },
  }).then((r) => r.text());

  const $ = cheerio.load(html);

  const models: { id: string; input: number; output: number }[] = [];
  const seen = new Set<string>();

  $("table").each((_, table) => {
    const text = $(table).text();
    if (!text.includes("在线推理") || !text.includes("元/千")) return;
    if (text.includes("TPM") || text.includes("量包")) return;

    let currentModel = "";

    $(table).find("tr").each((ri, row) => {
      if (ri === 0) return;
      const cells = $(row).find("td, th").toArray();
      const tds = cells.map((c) => $(c).text().trim().replace(/\s+/g, " "));

      // col0 = model name, col1 = version, col3 = sub-item (输入/输出), col4 = price
      const col0 = tds[0] || "";
      const col3 = tds[3] || "";
      const col4 = tds[4] || "";

      // Detect model name row
      if (col0 && !col0.startsWith("输入") && !col0.startsWith("输出") && !col0.startsWith("缓存") && !col0.startsWith("搜索") && !col0.startsWith("推理") && !col0.startsWith("命中")) {
        currentModel = col0;
      }
      if (!currentModel) return;

      // Use version name (col1) as the actual model ID, cleaned up
      const versionName = (tds[1] || "").trim();
      // Take only the first version name (stop before uppercase letter repeating pattern)
      const vMatch = versionName.match(/^([A-Z][\w.]*-[\w.]*)/);
      const actualName = vMatch ? vMatch[1] : currentModel;
      const id = actualName.toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      // Skip rows that aren't actually model names
      if (!id || !/^[a-z0-9]/.test(id) || id.length > 80) return;
      // Dedup: skip if we already have input+output for this model
      if (seen.has(id) && models.some((m) => m.id === id && m.input > 0 && m.output > 0)) return;
      seen.add(id);

      // Extract price from col4 (元/千tokens → multiply by 1000 for 元/百万tokens)
      const priceMatch = col4.match(/(\d+\.?\d*)/);
      if (!priceMatch) return;

      const price = parseFloat(priceMatch[1]) * 1000;
      const isInput = col3.startsWith("输入") && !col3.startsWith("输入法");
      const isOutput = col3.startsWith("输出");

      if (isInput) {
        models.push({ id, input: price, output: 0 });
      } else if (isOutput) {
        const existing = models.find((m) => m.id === id);
        if (existing) existing.output = price;
        else models.push({ id, input: 0, output: price });
      }
    });
  });

  console.log(`Found ${models.length} models`);

  let written = 0;
  for (const m of models) {
    const entry: ModelEntry = {
      id: m.id,
      name: m.id,
      created_by: "baidu",
      family: inferFamily(m.id) ?? "ernie",
      model_type: inferModelType(m.id) ?? "chat",
      pricing: { input: m.input, output: m.output || undefined },
      capabilities: { streaming: true, tool_call: true, structured_output: true },
      modalities: { input: ["text"], output: ["text"] },
    };
    written += upsertWithSnapshot("baidu", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
