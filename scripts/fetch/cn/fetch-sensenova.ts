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
  console.log("Fetching SenseNova model pricing...");

  const html = await fetch("https://www.sensecore.cn/help/docs/model-as-a-service/nova/pricing/", {
    headers: { "User-Agent": "Mozilla/5.0" },
  }).then((r) => r.text());

  const $ = cheerio.load(html);
  const models: { id: string; input: number; output: number; tts?: boolean; vision?: boolean; reasoning?: boolean }[] = [];
  const seen = new Set<string>();

  $("table").each((_, table) => {
    $(table).find("tr").each((ri, row) => {
      if (ri === 0) return;
      const cells = $(row).find("td").toArray();
      const texts = cells.map((c) => $(c).text().trim());

      // Extract model name from "XXX模型调用"
      const nameMatch = texts[0]?.match(/^(.+?)模型调用/);
      if (!nameMatch) return;
      const rawName = nameMatch[1];
      const id = rawName.toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-");
      if (seen.has(id)) return;
      seen.add(id);

      const isVision = rawName.toLowerCase().includes("vision") || rawName.toLowerCase().includes("vl");
      const isReasoning = rawName.toLowerCase().includes("reasoner");
      const isTTS = rawName.toLowerCase().includes("audio") || rawName.toLowerCase().includes("tts");

      // Table format varies:
      // a) Split: col1=inputLabel, col2=inputPrice, col3=outputLabel, col4=outputPrice
      // b) Combined: col1=combinedLabel, col2=combinedPrice
      // c) TTS: different unit (元/万字符)

      const parseP = (s: string): number => {
        const m = s.match(/([\d.]+)/);
        return m ? parseFloat(m[1]) : 0;
      };

      let input = 0, output = 0;

      if (texts.length >= 5) {
        // Split pricing: 输入tokens / 0.008元/千tokens / 输出tokens / 0.02元/千tokens
        const inP = parseP(texts[2] || "");
        const outP = parseP(texts[4] || "");
        if (inP > 0) input = inP * 1000;
        if (outP > 0) output = outP * 1000;
      } else if (texts.length >= 3) {
        // Combined or TTS pricing
        const p = parseP(texts[2] || "");
        if (isTTS) {
          // 元/万字符 - keep as-is
          input = p;
        } else {
          // 输入tokens、输出tokens - combined, 元/千tokens
          input = p * 1000;
        }
      }

      if (input === 0 && output === 0) return;
      models.push({ id, input, output, tts: isTTS || undefined, vision: isVision || undefined, reasoning: isReasoning || undefined });
    });
  });

  console.log(`Found ${models.length} models`);

  let written = 0;
  for (const m of models) {
    const capabilities: Record<string, boolean> = { streaming: true };
    if (!m.tts) { capabilities.tool_call = true; capabilities.structured_output = true; }
    if (m.reasoning) capabilities.reasoning = true;

    const modalities: { input: string[]; output: string[] } = { input: ["text"], output: ["text"] };
    if (m.vision) modalities.input.push("image");
    else if (m.tts) { modalities.input = ["text"]; modalities.output = ["audio"]; }

    const entry: ModelEntry = {
      id: m.id,
      name: m.id,
      created_by: "sensenova",
      family: inferFamily(m.id) ?? "sensenova",
      model_type: m.tts ? "tts" as const : (m.reasoning ? "reasoning" as const : (inferModelType(m.id) ?? "chat")),
      pricing: { input: m.input, ...(m.output > 0 ? { output: m.output } : {}) },
      capabilities,
      modalities,
    };
    written += upsertWithSnapshot("sensenova", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
