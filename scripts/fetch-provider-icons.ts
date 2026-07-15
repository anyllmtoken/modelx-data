import * as fs from "node:fs";
import * as path from "node:path";
import { getProvidersDir, runGenerate, setRegion } from "./shared.ts";

const LOBE_BASE =
  "https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons";

/**
 * provider → lobehub slug.
 * 彩色版按以下顺序探测: {slug}-brand-color.svg → {slug}-color.svg → {slug}.svg（单色回退）
 */
const ICONS: Record<string, string> = {
  // ── 有彩色版 ──
  ai21: "ai21-brand",
  alibaba: "alibaba",
  amazon: "aws",
  azure: "azure",
  bytedance: "bytedance",
  cerebras: "cerebras",
  cloudflare: "cloudflare",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "cloudflare",
  cohere: "cohere",
  deepinfra: "deepinfra",
  deepseek: "deepseek",
  fal: "fal",
  fireworks: "fireworks",
  google: "google",
  huggingface: "huggingface",
  meta: "meta",
  minimax: "minimax",
  mistral: "mistral",
  novita: "novita",
  nvidia: "nvidia",
  perplexity: "perplexity",
  qwen: "qwen",
  sambanova: "sambanova",
  stability: "stability",
  stepfun: "stepfun",
  together: "together",
  voyage: "voyage",
  zai: "zhipu",

  // ── 有 lobehub 入口（仅单色或无彩色版） ──
  anthropic: "anthropic",
  baseten: "baseten",
  "black-forest-labs": "bfl",
  cursor: "cursor",
  groq: "groq",
  inception: "inception",
  jina: "jina",
  nebius: "nebius",
  ollama: "ollama",
  openai: "openai",
  opencode: "opencode",
  openrouter: "openrouter",
  parasail: "parasail",
  recraft: "recraft",
  replicate: "replicate",
  siliconflow: "siliconcloud",
  vercel: "vercel",
  vertex: "vertexai",
  xai: "xai",
  baidu: "baiducloud",
  tencent: "hunyuan",
  spark: "spark",
  baichuan: "baichuan",
  sensenova: "sensenova",
  kling: "kling",
  zeroone: "zeroone",
  longcat: "longcat",
  qiniu: "qiniu",
  ai360: "ai360",
  baai: "baai",
  skywork: "skywork",
  internlm: "internlm",
};

function normalizeSvg(svg: string) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 24 24";
  const inner =
    svg
      .replace(/<\?xml[\s\S]*?\?>/g, "")
      .replace(/<!doctype[\s\S]*?>/gi, "")
      .replace(/<title>[\s\S]*?<\/title>/g, "")
      .match(/<svg[^>]*>([\s\S]*?)<\/svg>/)?.[1]
      .trim() ?? "";
  // 保留原始颜色，不强制 fill="currentColor"
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill-rule="evenodd">\n  ${inner.replace(/\n/g, "\n  ")}\n</svg>\n`;
}

async function fetchIcon(
  dir: string,
  provider: string,
  slug: string,
): Promise<boolean> {
  // 1. 优先 -brand-color
  let res = await fetch(`${LOBE_BASE}/${slug}-color.svg`);
  if (res.ok) {
    writeIcon(dir, provider, await res.text(), "color");
    return true;
  }
  // 2. 回退单色
  res = await fetch(`${LOBE_BASE}/${slug}.svg`);
  if (!res.ok) throw new Error(`Icon not found for ${provider} (${slug})`);
  writeIcon(dir, provider, await res.text(), "mono");
  return false;
}

function writeIcon(
  dir: string,
  provider: string,
  svg: string,
  kind: string,
): void {
  const outDir = path.join(dir, provider);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "icon.svg"), normalizeSvg(svg), "utf-8");
  console.log(`wrote ${provider}/icon.svg (${kind})`);
}

async function main() {
  if (process.argv.includes("--cn")) setRegion("cn");
  const selected = process.argv.slice(2).filter((a) => a !== "--cn");
  const entries = selected.length > 0
    ? selected.filter((k) => k in ICONS).map((k) => [k, ICONS[k]] as const)
    : Object.entries(ICONS);

  const dir = getProvidersDir();
  let color = 0;
  let mono = 0;

  for (const [provider, slug] of entries) {
    const isColor = await fetchIcon(dir, provider, slug);
    if (isColor) color++;
    else mono++;
  }

  console.log(`\nDone: ${color} color, ${mono} mono`);
  runGenerate({ requireModels: false });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
