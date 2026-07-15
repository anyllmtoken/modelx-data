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
  console.log("Fetching LongCat model pricing...");

  const html = await fetch("https://longcat.chat/platform/docs/zh/Pricing/LongCat-2.0.html", {
    headers: { "User-Agent": "Mozilla/5.0" },
  }).then((r) => r.text());

  // Extract prices from page text
  const inMatch = html.match(/输入（未命中缓存）[^\d]*¥?(\d+\.?\d*)[^¥]*¥?(\d+\.?\d*)/);
  const outMatch = html.match(/输出[^\d]*¥?(\d+\.?\d*)/);
  const cacheMatch = html.match(/输入（命中缓存）[^\d]*¥?(\d+\.?\d*)[^¥]*¥?(\d+\.?\d*)/);

  const input = inMatch ? parseFloat(inMatch[2] || inMatch[1]) : 2;
  const output = outMatch ? parseFloat(outMatch[1]) : 20;
  const cache = cacheMatch ? parseFloat(cacheMatch[2] || cacheMatch[1]) : 0.04;

  const entry: ModelEntry = {
    id: "longcat-2.0",
    name: "LongCat-2.0",
    created_by: "longcat",
    family: inferFamily("longcat-2.0") ?? "longcat",
    model_type: inferModelType("longcat-2.0") ?? "chat",
    pricing: { input, output, cached_input: cache },
    capabilities: { streaming: true, tool_call: true, structured_output: true },
    modalities: { input: ["text"], output: ["text"] },
  };

  const written = upsertWithSnapshot("longcat", entry) ? 1 : 0;
  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
