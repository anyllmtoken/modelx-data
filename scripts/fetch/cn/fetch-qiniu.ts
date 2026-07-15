import {
  type ModelEntry,
  runGenerate,
  setRegion,
  upsertWithSnapshot,
  inferModelType,
  inferFamily,
} from "./shared.ts";
import { fetchText } from "./parse.ts";

setRegion("cn");

/**
 * Qiniu (七牛云 AI 大模型广场) model fetch.
 * Source: https://www.qiniu.com/ai/models — Next.js SSR, __NEXT_DATA__ JSON.
 * Prices in 元/百万tokens (computed from unit_price / unit_size * 1_000_000).
 */

interface QiniuModel {
  id: string;
  name: string;
  issuer: { name: string };
  architecture: {
    input_modalities?: string[];
    output_modalities?: string[];
    function_calling?: { supported: boolean };
    reasoning?: { supported: boolean };
  };
  model_constraints?: { context_length?: number };
  pricing_rules_v2?: Array<{
    details_v2: {
      input?: { unit_price: number; unit_size: number };
      output?: { unit_price: number; unit_size: number };
    };
  }>;
}

const PROVIDER_MAP: Record<string, string> = {
  "DeepSeek": "deepseek",
  "zAI": "zai",
  "Minimax": "minimax",
  "月之暗面": "moonshot",
  "Qwen": "qwen",
  "零一万物": "zeroone",
  "智谱AI": "zai",
  "阿里巴巴": "qwen",
  "百度": "baidu",
  "百川智能": "baichuan",
  "面壁智能": "modelbest",
  "阶跃星辰": "stepfun",
};

function mapCreatedBy(name: string): string {
  return PROVIDER_MAP[name] ?? name.toLowerCase().replace(/\s+/g, "-");
}

async function main() {
  console.log("Fetching Qiniu AI models...");

  const html = await fetchText("https://www.qiniu.com/ai/models");
  const m = html.match(/__NEXT_DATA__[^>]*>(.*?)<\/script>/);
  if (!m) { console.error("No __NEXT_DATA__ found"); process.exit(1); }

  const data = JSON.parse(m[1]);
  const models: QiniuModel[] = data?.props?.pageProps?.models ?? [];
  console.log(`Found ${models.length} models`);

  let written = 0;
  let skipped = 0;

  for (const mod of models) {
    const raw = mod as Record<string, unknown>;
    if (raw.retirement_at) { skipped++; continue; }

    const pv2 = mod.pricing_rules_v2?.[0]?.details_v2;
    if (!pv2) { skipped++; continue; }

    const inP = pv2.input;
    const outP = pv2.output;
    const inputPrice = inP ? (inP.unit_price / inP.unit_size) * 1_000_000 : undefined;
    const outputPrice = outP ? (outP.unit_price / outP.unit_size) * 1_000_000 : undefined;
    if (inputPrice === undefined && outputPrice === undefined) { skipped++; continue; }

    const pricing: Record<string, unknown> = {};
    if (inputPrice != null) pricing.input = Math.round(inputPrice * 100) / 100;
    if (outputPrice != null) pricing.output = Math.round(outputPrice * 100) / 100;

    const mid = mod.id.replace(/\//g, "-").toLowerCase();
    const arch = mod.architecture ?? {};

    const capabilities: Record<string, boolean> = { streaming: true };
    if (arch.function_calling?.supported) {
      capabilities.tool_call = true;
      capabilities.structured_output = true;
    }
    if (arch.reasoning?.supported) capabilities.reasoning = true;

    const inputMods: string[] = [];
    for (const mod2 of arch.input_modalities ?? []) {
      if (["text", "image", "audio", "video"].includes(mod2)) inputMods.push(mod2);
    }
    if (inputMods.length === 0) inputMods.push("text");

    const entry: ModelEntry = {
      id: mid,
      name: mod.name,
      created_by: mapCreatedBy(mod.issuer?.name ?? "qiniu"),
      family: inferFamily(mid) ?? "qiniu",
      model_type: inferModelType(mid) ?? "chat",
      context_window: mod.model_constraints?.context_length,
      pricing: Object.keys(pricing).length > 0 ? pricing : undefined,
      capabilities,
      modalities: { input: inputMods as ("text" | "image" | "audio" | "video")[], output: ["text"] },
    };

    written += upsertWithSnapshot("qiniu", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written}, skipped ${skipped}`);
  runGenerate();
}

main().catch((err) => { console.error(err); process.exit(1); });
