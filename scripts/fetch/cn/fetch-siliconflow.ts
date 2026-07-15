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

async function main() {
  console.log("Fetching SiliconFlow models...");

  const html = await fetchText(
    "https://siliconflow.cn/models?page=1&pageSize=100",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    },
  );

  // Parse RSC-embedded model data
  const names = [
    ...html.matchAll(/\\"modelName\\":\\"([^"]+)\\"(?:,\\"mf\\":\\"([^"]*)\\")?/g),
  ].map((m) => ({ name: m[1]!, mf: m[2] ?? "" }));
  const inpPrices = [...html.matchAll(/\\"inputPrice\\":([\d.]+)/g)].map((m) =>
    Number(m[1]!),
  );
  const outPrices = [...html.matchAll(/\\"outputPrice\\":([\d.]+)/g)].map(
    (m) => Number(m[1]!),
  );
  const units = [
    ...html.matchAll(/\\"inputPriceUnit\\":\\"([^"]*)\\"/g),
  ].map((m) => m[1] ?? "/ M Tokens");

  const seen = new Set<string>();
  let written = 0;

  for (let i = 0; i < names.length; i++) {
    const fullName = names[i]!.name;
    if (seen.has(fullName)) continue;
    seen.add(fullName);

    const inp = inpPrices[i] ?? 0;
    const out = outPrices[i] ?? 0;
    const unit = units[i] ?? "/ M Tokens";
    const free = inp === 0 && out === 0;

    const id = fullName.replace(/\//g, "-").toLowerCase();
    const isText = !unit.includes("张") &&
      !unit.includes("字符") &&
      !fullName.includes("Image") &&
      !fullName.includes("Kolors") &&
      !fullName.includes("ASR") &&
      !fullName.includes("TTSD") &&
      !fullName.includes("CosyVoice") &&
      !fullName.includes("SenseVoice") &&
      !fullName.includes("Wan2");

    const pricing: Record<string, unknown> = {};
    if (!free && isText) {
      pricing.input = inp;
      pricing.output = out;
    } else if (!free) {
      pricing.input = inp;
      pricing.output = out;
    }

    const entry: ModelEntry = {
      id,
      name: fullName,
      created_by: "siliconflow",
      family: inferFamily(id) ?? "siliconflow",
      model_type: inferModelType(id) ?? "chat",
      pricing: Object.keys(pricing).length > 0 ? pricing : undefined,
      capabilities: { streaming: true },
      modalities: { input: ["text"], output: ["text"] },
    };

    written += upsertWithSnapshot("siliconflow", entry) ? 1 : 0;
  }

  console.log(`Parsed ${seen.size} unique models, wrote ${written}`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
