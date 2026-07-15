import {
  type ModelEntry,
  runGenerate,
  setRegion,
  upsertWithSnapshot,
  inferModelType,
  inferFamily,
} from "./shared.ts";
import { fetchJson } from "./parse.ts";

setRegion("cn");

/**
 * iFlytek Spark MaaS platform model fetch.
 * API: GET https://maas.xfyun.cn/api/v1/gpt-finetune/model/base/list-v2
 * Prices in 元/百万tokens.
 */

interface ApiModel {
  name: string;
  userName: string;
  serviceId: string;
  categoryTree: Array<{
    key: string;
    children: Array<{ name: string; key: string }>;
  }>;
  price: {
    inferencePrice?: {
      inTokensPrice?: number;
      outTokensPrice?: number;
      cacheTokensPrice?: number;
      showPrice: boolean;
    };
  };
}

function getProviderName(m: ApiModel): string | undefined {
  for (const cat of m.categoryTree) {
    if (cat.key === "modelProvider") {
      return cat.children[0]?.name;
    }
  }
  return undefined;
}

function getContextLength(m: ApiModel): number | undefined {
  for (const cat of m.categoryTree) {
    if (cat.key === "contextLengthTag") {
      for (const child of cat.children) {
        const n = child.name;
        if (n.endsWith("M")) return (parseFloat(n) * 1_000_000) | 0;
        if (n.endsWith("K") || n.endsWith("k")) return (parseFloat(n) * 1_000) | 0;
        const num = parseInt(n, 10);
        if (!isNaN(num)) return num;
      }
    }
  }
  return undefined;
}

/** Map Chinese provider name to modelx-data provider id */
function mapCreatedBy(userName: string): string {
  const map: Record<string, string> = {
    "科大讯飞": "spark",
    "月之暗面": "moonshot",
    "智谱AI": "zai",
    "深度求索": "deepseek",
    "阿里巴巴": "qwen",
    "腾讯": "tencent",
    "百度飞桨": "baidu",
    "MiniMax": "minimax",
    "BigCode": "bigcode",
    "Stability AI": "stability",
  };
  return map[userName] ?? userName.toLowerCase().replace(/\s+/g, "-");
}

async function main() {
  console.log("Fetching iFlytek Spark MaaS models...");

  const apiUrl = "https://maas.xfyun.cn/api/v1/gpt-finetune/model/base/list-v2?page=1&size=100";
  const data = await fetchJson<{ code: number; data: { rows: ApiModel[] } }>(apiUrl);

  if (data.code !== 0) {
    console.error("API error:", data.code);
    process.exit(1);
  }

  const rows = data.data.rows;
  let written = 0;
  let skipped = 0;

  for (const m of rows) {
    const p = m.price?.inferencePrice;
    if (!p?.showPrice) { skipped++; continue; }

    const sid = m.serviceId || m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const createdBy = mapCreatedBy(m.userName);
    const ctx = getContextLength(m);

    // Determine if this is a vision model
    const isVision = m.categoryTree.some((cat) =>
      cat.key === "modelCategory" && cat.children?.some((c) =>
        ["多模态", "视觉", "图像"].includes(c.name)
      )
    );

    const pricing: Record<string, unknown> = {};
    if (p.inTokensPrice != null) pricing.input = p.inTokensPrice;
    if (p.outTokensPrice != null) pricing.output = p.outTokensPrice;
    if (p.cacheTokensPrice != null && p.cacheTokensPrice > 0) pricing.cached_input = p.cacheTokensPrice;

    const capabilities: Record<string, boolean> = { streaming: true };
    if (!m.name.toLowerCase().includes("embedding") && !m.name.toLowerCase().includes("reranker")) {
      capabilities.tool_call = true;
      capabilities.structured_output = true;
    }

    const modalities: { input: string[]; output: string[] } = { input: ["text"], output: ["text"] };
    if (isVision) modalities.input.push("image");

    const displayName = m.name;

    const entry: ModelEntry = {
      id: sid,
      name: displayName,
      created_by: createdBy,
      family: inferFamily(sid) ?? "spark",
      model_type: m.name.toLowerCase().includes("embedding") ? "embed" as const
        : m.name.toLowerCase().includes("reranker") ? "rerank" as const
        : inferModelType(sid) ?? "chat",
      context_window: ctx,
      pricing: Object.keys(pricing).length > 0 ? pricing : undefined,
      capabilities,
      modalities,
    };

    written += upsertWithSnapshot("spark", entry) ? 1 : 0;
  }

  console.log(`Parsed ${rows.length} models (${skipped} without pricing), wrote ${written}`);
  runGenerate();
}

main().catch((err) => { console.error(err); process.exit(1); });
