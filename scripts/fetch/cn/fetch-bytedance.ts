import * as cheerio from "cheerio";
import {
  type ModelEntry,
  runGenerate,
  setRegion,
  upsertModel,
  upsertWithSnapshot,
  sanitizeModelId,
  inferModelType,
  inferFamily,
  readSources,
} from "./shared.ts";
import { fetchText } from "./parse.ts";
import { enrichEntry } from "./provider-fetch-utils.ts";

setRegion("cn");

// ── Part 1: Scrape Seed model catalog from website ──

interface SeedCard { title: string; description?: string; link?: string }

const sources = readSources("bytedance");

function parseRouterData(html: string): SeedCard[] {
  const m = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})<\/script>/);
  if (!m) throw new Error("Could not find ByteDance Seed router data");
  const data = JSON.parse(m[1]);
  const tabs = data.loaderData?.["(locale$)/models/page"]?.research_tabs?.en;
  if (!Array.isArray(tabs)) throw new Error("Could not find Seed model tabs");
  return tabs.flatMap((t: { cards?: SeedCard[] }) => t.cards ?? []);
}

function idFromTitle(title: string) {
  return sanitizeModelId(title.replace(/[()]/g, "").replace(/（/g, "-").replace(/）/g, "").replace(/\s+/g, "-"));
}

function inferSeedType(title: string): ModelEntry["model_type"] {
  const l = title.toLowerCase();
  if (l.includes("seedance")) return "video";
  if (l.includes("seedream") || l.includes("seededit")) return "image";
  if (l.includes("voice") || l.includes("interpret")) return "audio";
  if (l.includes("music")) return "audio";
  if (l.includes("diffusion")) return "code";
  if (l.includes("3d") || l.includes("protenix") || l.includes("gr-")) return "other";
  return "chat";
}

async function scrapeSeedModels() {
  console.log("Fetching ByteDance Seed models page...");
  const html = await fetchText(sources.models as string);
  const cards = parseRouterData(html);
  console.log(`Parsed ${cards.length} models from ByteDance Seed`);
  let written = 0;
  for (const card of cards) {
    const entry = enrichEntry(
      { id: idFromTitle(card.title), name: card.title, created_by: "bytedance", model_type: inferSeedType(card.title), page_url: card.link, status: "active" },
      { description: card.description, modelTypeHint: card.title },
    );
    written += upsertModel("bytedance", entry) ? 1 : 0;
  }
  console.log(`Scraped ${written} models`);
}

// ── Part 2: Extract ALL pricing from docs page MDContent ──

function extractRouterJson(html: string): Record<string, unknown> {
  const $ = cheerio.load(html);
  const scriptText = $("script").toArray().map((el) => $(el).text()).find((t) => t.includes("window._ROUTER_DATA ="));
  if (!scriptText) throw new Error("_ROUTER_DATA script not found");
  const jsonStart = scriptText.indexOf("{");
  let depth = 0, inStr = false, esc = false, jsonEnd = -1;
  for (let i = jsonStart; i < scriptText.length; i++) {
    const c = scriptText[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
  }
  return JSON.parse(scriptText.slice(jsonStart, jsonEnd));
}

function parseRow(line: string): string[] {
  const content = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "", inTag = false;
  for (const ch of content) {
    if (ch === "<") inTag = true;
    else if (ch === ">") { inTag = false; cur += ch; continue; }
    if (ch === "|" && !inTag) { cells.push(cur.trim()); cur = ""; } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const clean = (s: string) => s.replace(/<[^>]+>/g, "").trim().replace(/\\-/g, "-");

function firstPrice(text: string): number | null {
  const v = clean(text);
  if (!v || v === "-" || v === "—") return null;
  // Prefer price after colon (：or :) to avoid matching pixel counts like "236万像素"
  const colonMatch = v.match(/[：:]\s*(\d+\.?\d*)/);
  if (colonMatch) return parseFloat(colonMatch[1]);
  // Fallback: just first number
  const m = v.match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
}

// Find all pipe tables from MDContent by grouping pipe lines
function extractAllTables(md: string): { section: string; table: string }[] {
  // Split into sections by # headings
  const sectionHeaders = md.split(/\n(?=## |# )/);
  const tables: { section: string; table: string }[] = [];
  for (const sh of sectionHeaders) {
    // Group consecutive pipe lines in this section
    const lines = sh.split("\n");
    let current: string[] = [];
    for (const l of lines) {
      if (l.trim().startsWith("|")) current.push(l);
      else if (current.length > 1) {
        tables.push({ section: sh.substring(0, 100).replace(/\n/g, " "), table: current.join("\n") });
        current = [];
      } else current = [];
    }
    if (current.length > 1) tables.push({ section: sh.substring(0, 100).replace(/\n/g, " "), table: current.join("\n") });
  }
  return tables;
}

interface ParsedModel {
  id: string;
  modelType: ModelEntry["model_type"];
  pricing: Record<string, unknown>;
  capabilities?: Record<string, boolean>;
  modalities?: { input: string[]; output: string[] };
}

function parseLlmTable(table: string): ParsedModel[] {
  const lines = table.trim().split("\n");
  if (lines.length < 2) return [];
  const header = parseRow(lines[0]);
  const dataLines = lines.slice(2).filter((l) => !l.includes("---"));

  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const nameIdx = col("模型名称");
  const inputIdx = col("输入(非音频)");
  const audioIdx = col("输入(音频)");
  const cacheIdx = col("缓存命中(非音频)");
  const outputIdx = col("输出");

  if (nameIdx < 0) return [];

  const result: ParsedModel[] = [];
  let lastName = "";
  for (const line of dataLines) {
    const cells = parseRow(line);
    const rawName = clean(cells[nameIdx] ?? "");
    if (rawName && rawName !== "-" && !rawName.startsWith("输入") && !rawName.startsWith("输出") && !rawName.startsWith("缓存")) lastName = rawName;
    if (!lastName) continue;
    const id = lastName.toLowerCase();
    if (result.some((m) => m.id === id)) continue;

    const inp = firstPrice(cells[inputIdx] ?? "");
    const audio = audioIdx >= 0 ? firstPrice(cells[audioIdx] ?? "") : null;
    const cache = cacheIdx >= 0 ? firstPrice(cells[cacheIdx] ?? "") : null;
    const out = firstPrice(cells[outputIdx] ?? "");
    if (inp === null && out === null) continue;

    const pricing: Record<string, unknown> = {};
    if (inp !== null) pricing.input = inp;
    if (out !== null) pricing.output = out;
    if (cache !== null) pricing.cached_input = cache;
    if (audio !== null) pricing.audio_input = audio;

    const isVision = id.includes("vision");
    const isReasoning = id.includes("evolving") || id.includes("r1");
    const isTrans = id.includes("translation");

    result.push({
      id,
      modelType: inferModelType(id) ?? "chat",
      pricing,
      capabilities: {
        streaming: true,
        ...(isReasoning ? { reasoning: true } : {}),
        ...(!isTrans ? { tool_call: true, structured_output: true } : {}),
        ...(isVision ? { vision: true } : {}),
      },
      modalities: { input: isVision ? ["text", "image"] : ["text"], output: ["text"] },
    });
  }
  return result;
}

function parseMediaTable(table: string, section: string): ParsedModel[] {
  const lines = table.trim().split("\n");
  if (lines.length < 2) return [];
  const header = parseRow(lines[0]);
  const dataLines = lines.slice(2).filter((l) => !l.includes("---"));

  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const nameIdx = col("模型");
  const nameIdx2 = col("模型名称");

  // Skip if this isn't a model pricing table (no model column, or model column is about plans/套餐)
  const idx = (nameIdx >= 0 ? nameIdx : nameIdx2);
  if (idx < 0) return [];
  const firstDataCell = clean(parseRow(dataLines[0] ?? "")[idx] ?? "");
  // Skip non-model tables: plans, resource specs, billing items, etc.
  if (!firstDataCell || firstDataCell === "-" || firstDataCell.includes("套餐") || firstDataCell.includes("方舟") || firstDataCell.includes("资源") || firstDataCell.includes("计费项")) return [];

  // Determine media type from section header or model names
  let mediaType: ModelEntry["model_type"] = "other";
  const hasVideo = dataLines.some(l => l.includes("seedance"));
  const hasImage = dataLines.some(l => l.includes("seedream"));
  const has3d = dataLines.some(l => l.includes("seed3d") || l.includes("hyper3d") || l.includes("hitem3d"));
  const hasEmbedding = dataLines.some(l => l.includes("embedding"));
  if (hasVideo) mediaType = "video";
  else if (hasImage) mediaType = "image";
  else if (has3d) mediaType = "other";
  else if (hasEmbedding) mediaType = "embedding";
  // For mixed or unknown media tables, use section hint
  if (section.includes("图片生成")) mediaType = "image";
  else if (section.includes("视频生成")) mediaType = "video";
  else if (section.includes("3D生成")) mediaType = "other";
  else if (section.includes("向量模型")) mediaType = "embedding";

  const result: ParsedModel[] = [];

  for (const line of dataLines) {
    const cells = parseRow(line);
    const rawName = clean(cells[idx] ?? "");
    if (!rawName || rawName === "-" || rawName === "—") continue;
    if (rawName.startsWith("输入") || rawName.startsWith("输出") || rawName.startsWith("缓存")) continue;
    // Take only model name before description markers
    const shortName = rawName.split(/[>]/)[0].split("<br")[0].trim().toLowerCase();
    if (!shortName || shortName.includes("套餐") || shortName.includes("服务项") || shortName === "模型" || shortName === "机型") continue;
    const id = shortName;

    if (result.some((m) => m.id === id)) continue;

    // Try to find price in various column formats
    const priceCols = [col("输出单价"), col("输出图单价"), col("在线推理"), col("文本输入")];
    let price: number | null = null;
    for (const pc of priceCols) {
      if (pc >= 0) { price = firstPrice(cells[pc] ?? ""); if (price !== null) break; }
    }
    // For video, some have the price embedded in the first column with resolution info
    if (price === null && mediaType === "video") {
      const vCell = clean(cells[1] ?? "");
      const m = vCell.match(/输入不含视频[：:]\s*(\d+\.?\d*)/);
      if (m) price = parseFloat(m[1]);
    }

    if (price === null) continue;

    const pricing: Record<string, unknown> = mediaType === "embedding"
      ? { input: price, output: price } : { input: price };
    // For image: also try to get output price
    if (mediaType === "image") {
      const outCol = col("输出图单价");
      const outPrice = outCol >= 0 ? firstPrice(cells[outCol] ?? "") : null;
      if (outPrice !== null) pricing.output = outPrice;
    }

    let modalities: { input: string[]; output: string[] };
    if (mediaType === "video") modalities = { input: ["text", "image"], output: ["video"] };
    else if (mediaType === "image") modalities = { input: ["text", "image"], output: ["image"] };
    else if (mediaType === "embedding") modalities = { input: ["text", "image"], output: ["text"] };
    else modalities = { input: ["text", "image"], output: ["image"] };

    result.push({ id, modelType: mediaType, pricing, capabilities: { streaming: true }, modalities });
  }
  return result;
}

function parseAllPricing(md: string): ParsedModel[] {
  const tables = extractAllTables(md);
  const all: ParsedModel[] = [];
  for (const { section, table } of tables) {
    if (section.includes("在线推理（常规）")) {
      all.push(...parseLlmTable(table));
    } else {
      const media = parseMediaTable(table, section);
      if (media.length > 0) all.push(...media);
    }
  }
  return all;
}

function applyModels(models: ParsedModel[]) {
  let written = 0;
  for (const m of models) {
    const isDoubao = m.id.startsWith("doubao");
    const entry: ModelEntry = {
      id: m.id,
      name: m.id,
      created_by: "bytedance",
      family: inferFamily(m.id) ?? (isDoubao ? "doubao" : undefined),
      model_type: m.modelType,
      pricing: Object.keys(m.pricing).length > 0 ? m.pricing : undefined,
      capabilities: m.capabilities,
      modalities: m.modalities,
    };
    written += upsertWithSnapshot("bytedance", entry) ? 1 : 0;
  }
  console.log(`Applied pricing to ${written} models`);
}

// ── Main ──

async function main() {
  await scrapeSeedModels();

  console.log("Fetching pricing from docs.volcengine.com MDContent...");
  const docHtml = await fetch("https://docs.volcengine.com/docs/82379/1544106?lang=zh").then((r) => r.text());
  const routerData = extractRouterJson(docHtml);
  const curDoc = (routerData as any).loaderData?.["docs/(libid)/(docid$)/page"]?.curDoc;
  if (!curDoc?.MDContent) throw new Error("MDContent not found");
  const mdContent = curDoc.MDContent as string;
  console.log(`Got MDContent: ${mdContent.length} chars`);

  const models = parseAllPricing(mdContent);
  console.log(`Parsed ${models.length} model pricing entries`);
  for (const m of models) console.log(`  ${m.id}: ${m.modelType} price=${JSON.stringify(m.pricing)}`);

  applyModels(models);
  runGenerate();
}

main().catch((err) => { console.error(err); process.exit(1); });
