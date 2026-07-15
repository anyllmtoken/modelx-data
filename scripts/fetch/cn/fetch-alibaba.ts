import { fetchText, parseTokenCount } from "./parse.ts";
import { modalitiesForType } from "./provider-fetch-utils.ts";
import {
  assertParsed,
  inferFamily,
  inferModelType,
  inferParameters,
  type ModelEntry,
  readSources,
  runGenerate,
  setRegion,
  upsertWithSnapshot,
} from "./shared.ts";

setRegion("cn");

/**
 * Fetch 阿里云百炼 (Bailian) models:
 * 1. Parse doc pages for model IDs + specs
 * 2. Call internal API for CNY pricing + enrichment
 */

const sources = readSources("alibaba");
const DOCS_MD = sources.docs as string;

// Third-party models hosted on Bailian — skip
const THIRD_PARTY =
  /^(deepseek|glm|kimi|minimax|moonshot|ernie|baichuan|llama|gpt|claude|gemini|mistral|yi-|internlm|chatglm|step|abab|spark|hunyuan|doubao|seed|gte-)/i;

// ── API pricing fetch ──

interface ApiPrice {
  price: string;
  type: string;
  priceUnit?: string;
  priceName?: string;
}

interface ApiModel {
  model: string;
  prices?: ApiPrice[];
  multiPrices?: { rangeStart?: number; rangeEnd?: number; rangeName?: string; prices: ApiPrice[] }[];
  modelInfo?: { contextWindow?: number; maxInputTokens?: number; maxOutputTokens?: number };
  inferenceMetadata?: { request_modality?: string[]; response_modality?: string[] };
  features?: string[];
}

const API_ENDPOINT =
  "https://bailian-cs.console.aliyun.com/data/api.json?action=BroadScopeAspnGateway&product=sfm_bailian&api=zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listFoundationModels";

function buildBody(pageNo: number, pageSize: number) {
  const params = new URLSearchParams();
  params.set(
    "params",
    JSON.stringify({
      Api: "zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listFoundationModels",
      V: "1.0",
      Data: {
        input: { pageNo, pageSize, queryPrice: true, group: true, supports: { inference: true } },
        cornerstoneParam: { xsp_lang: "zh-CN" },
      },
    }),
  );
  params.set("region", "cn-beijing");
  return params;
}

async function fetchApiModels(): Promise<ApiModel[]> {
  const pageSize = 60;
  const first = await fetchApiPage(1, pageSize);
  const total = first.total;
  const items = [...first.models];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  for (let p = 2; p <= pageCount; p++) {
    try {
      const page = await fetchApiPage(p, pageSize);
      items.push(...page.models);
    } catch (e) {
      console.warn(`  API page ${p} failed:`, (e as Error).message);
    }
  }

  return items;
}

async function fetchApiPage(pageNo: number, pageSize: number) {
  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    body: buildBody(pageNo, pageSize),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as {
    data: { DataV2: { data: { data: { total: number; list: { name: string; items?: ApiModel[] }[] } } } };
  };

  const inner = json.data.DataV2.data.data;
  // Take first item per group
  const models: ApiModel[] = [];
  for (const group of inner.list) {
    const items = group.items ?? [];
    if (items.length > 0) models.push(items[0]);
  }

  return { total: inner.total, models };
}

// ── Doc-based model discovery ──

function inferLicense(id: string): string {
  if (
    /^qwen-(max|plus|turbo|vl-max|vl-plus|long|math|omni-turbo)/i.test(id) ||
    /^qwen3\.5-(plus|max)/i.test(id)
  )
    return "proprietary";
  if (/^(qwen|qwq|qvq)/i.test(id)) return "apache-2.0";
  return "proprietary";
}

/** Parse HTML tables, extracting model IDs from the first column. */
function parseTables(html: string): { header: string[]; rows: { cells: string[]; id: string | null }[] }[] {
  return [...html.matchAll(/<table>([\s\S]*?)<\/table>/g)].map((t) => {
    const trMatches = [...t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
    const rows = trMatches.map((tr) => {
      const cellHtml = [...tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)];
      const cells = cellHtml.map((c) =>
        c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      );
      const firstText = cells[0] ?? "";
      const firstToken = firstText.split(/\s+/)[0] ?? "";
      const id = /^[a-z][a-z0-9][-.a-z0-9/]{0,60}$/i.test(firstToken)
        ? firstToken
        : null;
      return { cells, id };
    });
    return {
      header: (rows[0]?.cells ?? []).map((h) => h.toLowerCase()),
      rows: rows.slice(1),
    };
  });
}

function discoverDetailPages(hubMd: string): string[] {
  const links = [
    ...hubMd.matchAll(/\((https:\/\/help\.aliyun\.com\/document_detail\/\d+\.html)\)/g),
  ].map((m) => `${m[1]}.md`);
  return [...new Set(links)];
}

// ── Pricing mapping ──

const PRICE_TYPE_MAP: Record<string, string> = {
  input_token: "input",
  output_token: "output",
  input_token_cache: "cached_input",
  input_token_cache_creation_5m: "cache_write",
};

/** Extract flat pricing from the first tier of multiPrices or flat prices array. */
function apiPricesToPricing(prices: ApiPrice[] | undefined, multiPrices: ApiModel["multiPrices"]): Record<string, unknown> | undefined {
  // Prefer multiPrices first tier (base range), fall back to flat prices
  const src = multiPrices?.[0]?.prices ?? prices ?? [];
  const flat: Record<string, number | null> = {};
  for (const p of src) {
    const key = PRICE_TYPE_MAP[p.type] ?? p.type;
    const val = parseFloat(p.price);
    if (!isNaN(val)) flat[key] = val;
  }
  return Object.keys(flat).length > 0 ? flat : undefined;
}

const CHAT_TYPES = new Set(["chat", "reasoning", "code"]);

async function main() {
  console.log("Fetching Bailian (阿里云百炼) models...");

  // ── Phase 1: Fetch pricing from API ──

  console.log("Phase 1: Fetching pricing from API...");
  let apiModels: ApiModel[] = [];
  try {
    apiModels = await fetchApiModels();
    console.log(`  Got ${apiModels.length} models with pricing from API`);
  } catch (e) {
    console.warn("  API failed, continuing without pricing:", (e as Error).message);
  }

  const apiPricingMap = new Map<string, ApiModel>();
  for (const m of apiModels) {
    apiPricingMap.set(m.model, m);
  }

  // ── Phase 2: Parse docs for model IDs + specs ──

  console.log("Phase 2: Parsing doc pages...");
  const hub = await fetchText(DOCS_MD);
  const detailPages = discoverDetailPages(hub);
  console.log(`  Discovered ${detailPages.length} detail pages`);
  assertParsed(detailPages.length, "alibaba (detail page discovery)");

  const seen = new Set<string>();
  let written = 0;

  const isModelTable = (h: string[]) => {
    const c0 = h[0] ?? "";
    return c0 === "model" || c0 === "model id" || c0.includes("模型") || c0.includes("model");
  };

  for (const url of detailPages) {
    let html: string;
    let finalUrl = url;
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) { console.warn(`  Could not fetch ${url}: ${res.status}`); continue; }
      finalUrl = res.url;
      html = await res.text();
    } catch { console.warn(`  Could not fetch ${url}`); continue; }

    for (const table of parseTables(html)) {
      if (!isModelTable(table.header)) continue;

      const ctxIdx = table.header.findIndex((h) => h.includes("context") || h.includes("上下文"));
      const outIdx = table.header.findIndex((h) => h.includes("max output") || h.includes("最大输出"));
      const capCols = table.header.map((h, i) => ({ h, i })).filter(({ h }) =>
        /function calling|thinking|structured output|batch|函数调用|思考模式|结构化输出|批量/.test(h));

      for (const row of table.rows) {
        const id = row.id;
        if (!id || id.includes("/") || id.includes(" ") || THIRD_PARTY.test(id)) continue;
        if (/latest$/.test(id) || /-\d{4}-\d{2}-\d{2}$/.test(id)) continue;
        if (seen.has(id)) continue;
        seen.add(id);

        const modelType = inferModelType(id) ?? "chat";
        const allText = row.cells.join(" ").toLowerCase();

        const capabilities: Record<string, boolean> = { streaming: true };
        for (const { h, i } of capCols) {
          if (!/supported|是|yes/i.test(row.cells[i] ?? "")) continue;
          if (h.includes("function calling") || h.includes("函数调用")) capabilities.tool_call = true;
          if (h.includes("structured output") || h.includes("结构化输出")) capabilities.structured_output = true;
          if (h.includes("thinking") || h.includes("思考")) capabilities.reasoning = true;
          if (h.includes("batch") || h.includes("批量")) capabilities.batch = true;
        }
        if (/\bvl\b|vision|-vl-|omni/.test(id)) capabilities.vision = true;

        // ── Merge API pricing data ──
        const apiModel = apiPricingMap.get(id);
        let pricing: Record<string, unknown> | undefined;
        if (apiModel && (apiModel.prices?.length || apiModel.multiPrices?.length)) {
          pricing = apiPricesToPricing(apiModel.prices, apiModel.multiPrices);
        }

        // API also has context window — prefer API over doc table
        const ctxWindow = apiModel?.modelInfo?.contextWindow;
        const maxOutput = apiModel?.modelInfo?.maxOutputTokens;

        const entry: ModelEntry = {
          id,
          name: id,
          created_by: "qwen",
          family: inferFamily(id),
          page_url: finalUrl,
          license: inferLicense(id),
          model_type: modelType,
          capabilities,
          pricing, // ← CNY pricing from API
          modalities: modalitiesForType(modelType as ModelEntry["model_type"], `${id} ${allText}`),
          ...(inferParameters(id) ?? {}),
        };
        if (capabilities.reasoning) entry.reasoning_tokens = true;

        if (CHAT_TYPES.has(modelType)) {
          entry.context_window = ctxWindow ?? parseTokenCount(row.cells[ctxIdx] ?? "");
          entry.max_output_tokens = maxOutput ?? parseTokenCount(row.cells[outIdx] ?? "");
        }

        written += upsertWithSnapshot("alibaba", entry);
      }
    }
  }

  assertParsed(seen.size, "alibaba");
  console.log(`Parsed ${seen.size} unique models, wrote ${written}`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
