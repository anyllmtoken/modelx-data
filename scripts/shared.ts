/**
 * Shared utilities for fetch scripts.
 * Adapted from modelpedia packages/data/scripts/shared.ts.
 *
 * Key changes from original:
 * - PROVIDERS_DIR is region-aware via setRegion() / getProvidersDir()
 * - runGenerate() passes --cn / --us flag
 * - Everything else is identical to the original
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

let _region: "cn" | "us" = "us";

/** Set the active region. Call before any read/write. */
export function setRegion(region: "cn" | "us"): void { _region = region; }
export function getRegion(): "cn" | "us" { return _region; }
export function getProvidersDir(): string { return path.join(ROOT, `providers-${_region}`); }

// ── IO ──

export function readSources(provider: string): Record<string, unknown> {
  const fp = path.join(getProvidersDir(), provider, "_sources.json");
  if (!fs.existsSync(fp)) return {};
  return JSON.parse(fs.readFileSync(fp, "utf-8"));
}

export function readModelJson(provider: string, modelId: string): Record<string, unknown> | null {
  const fp = path.join(getProvidersDir(), provider, "models", `${modelId}.json`);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, "utf-8"));
}

export function writeModelJson(provider: string, modelId: string, data: Record<string, unknown>) {
  const dir = path.join(getProvidersDir(), provider, "models");
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${modelId}.json`);
  fs.writeFileSync(fp, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  console.log(`  wrote ${provider}/models/${modelId}.json`);
}

let upsertAttempts = 0;
export function recordUpsertAttempt(): void { upsertAttempts++; }

export function runGenerate(opts?: { requireModels?: boolean }): void {
  if (opts?.requireModels !== false && upsertAttempts === 0) {
    throw new Error("fetch parsed 0 models before generate; upstream source likely changed");
  }
  console.log(`\nRegenerating data-${_region}.ts...`);
  try { execSync(`bun scripts/generate.ts --${_region}`, { stdio: "inherit", cwd: ROOT }); }
  catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("bun")) throw err;
    console.warn("bun not available; falling back to jiti");
    execSync(`pnpm exec jiti scripts/generate.ts --${_region}`, { stdio: "inherit", cwd: ROOT });
  }
}

// ── Env ──

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`Missing env var: ${name}`); process.exit(1); }
  return v;
}
export function envOrNull(...names: string[]): string | null {
  for (const n of names) if (process.env[n]) return process.env[n]!;
  return null;
}

// ── Utils ──

function hashValue(val: unknown): string {
  return createHash("md5").update(JSON.stringify(val)).digest("hex").slice(0, 8);
}
export function sanitizeModelId(id: string): string { return id.replace(/[^a-z0-9._-]/gi, "-").toLowerCase(); }
export function today(): string { return new Date().toISOString().split("T")[0]; }
export function firstSentence(text: string): string {
  const m = text.match(/^(.+?\.)\s/);
  return m ? m[1] : text.slice(0, 200);
}
const VALID_MODALITIES = new Set(["text", "image", "audio", "video"]);
export function assertParsed(parsedCount: number, label: string): void {
  if (parsedCount <= 0) throw new Error(`${label}: parsed 0 models; upstream structure likely changed`);
}
export function filterModalities(input: string[], output: string[]) {
  return { input: input.filter(m => VALID_MODALITIES.has(m)), output: output.filter(m => VALID_MODALITIES.has(m)) };
}

// ── Markdown ──

export function parseMarkdownTable(lines: string[]): string[][] {
  const rows: string[][] = [];
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (line.replace(/[|:\-\s]/g, "") === "") continue;
    rows.push(line.split("|").slice(1, -1).map(c => c.replace(/\*\*/g, "").trim()));
  }
  return rows;
}

// ── HTTP cache ──

export async function fetchCached(url: string, opts: { scope: string; label: string; ttlMs?: number }): Promise<string> {
  const ttl = opts.ttlMs ?? 10 * 60 * 1000;
  const dir = path.join(ROOT, ".cache", opts.scope);
  fs.mkdirSync(dir, { recursive: true });
  const cp = path.join(dir, `${opts.label}.txt`);
  if (process.env.FETCH_NO_CACHE !== "1" && fs.existsSync(cp)) {
    const age = Date.now() - fs.statSync(cp).mtimeMs;
    if (age < ttl) { console.log(`  cache hit: ${opts.scope}/${opts.label} (${Math.round(age/1000)}s)`); return fs.readFileSync(cp, "utf-8"); }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${opts.label} fetch failed: ${res.status}`);
  const body = await res.text();
  fs.writeFileSync(cp, body, "utf-8");
  return body;
}

// ── Date normalization ──

const MONTH_MAP: Record<string, string> = {
  jan:"01",january:"01",feb:"02",february:"02",mar:"03",march:"03",apr:"04",april:"04",
  may:"05",jun:"06",june:"06",jul:"07",july:"07",aug:"08",august:"08",
  sep:"09",september:"09",oct:"10",october:"10",nov:"11",november:"11",dec:"12",december:"12",
};

export function normalizeDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const s = date.trim();
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return s;
  const mdy = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mdy) { const mm = MONTH_MAP[mdy[1].toLowerCase()]; if (mm) return `${mdy[3]}-${mm}-${String(mdy[2]).padStart(2,"0")}`; }
  const my = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (my) { const mm = MONTH_MAP[my[1].toLowerCase()]; if (mm) return `${my[2]}-${mm}`; }
  return null;
}

// ── Family inference ──

export function inferFamily(modelId: string): string | undefined {
  const slash = modelId.indexOf("/");
  let name = slash !== -1 ? modelId.slice(slash + 1) : modelId;
  name = name.replace(/^gemini-(?:live|robotics-\w+)-/i, "gemini-");
  const rules: [RegExp, string | null][] = [
    [/^(gpt-5\.\d+)/, null], [/^gpt-5(?:-|$)/, "gpt-5"], [/^(gpt-4\.1)/, null],
    [/^gpt-4o/, "gpt-4o"], [/^gpt-4-turbo/, "gpt-4-turbo"], [/^gpt-4(?:-|$)/, "gpt-4"],
    [/^gpt-3\.5/, "gpt-3.5"], [/^(gpt-image-\d+\.?\d*)/, null], [/^gpt-image/, "gpt-image"],
    [/^gpt-realtime/, "gpt-realtime"], [/^gpt-audio/, "gpt-audio"], [/^gpt-oss/, "gpt-oss"],
    [/^(o\d+)(?:-|$)/, null], [/^codex/, "codex"], [/^chatgpt/, "chatgpt"],
    [/^claude.*opus/, "claude-opus"], [/^claude.*sonnet/, "claude-sonnet"],
    [/^claude.*haiku/, "claude-haiku"], [/^claude.*fable/, "claude-fable"],
    [/^claude.*mythos/, "claude-mythos"], [/^claude/, "claude"],
    [/^(gemini-\d+\.?\d*)/, null], [/^(gemma-\d+\w*)/, null],
    [/^(grok-\d+\.?\d*)/, null], [/^grok-code/, "grok-code"], [/^grok-imagine/, "grok-imagine"],
    [/^deepseek-r\d+/, "deepseek-r1"], [/^deepseek-reasoner/, "deepseek-reasoner"],
    [/^deepseek-chat/, "deepseek-chat"], [/^deepseek/, "deepseek"],
    [/^mistral-large/, "mistral-large"], [/^mistral-small/, "mistral-small"],
    [/^mistral-medium/, "mistral-medium"], [/^codestral/, "codestral"],
    [/^ministral/, "ministral"], [/^pixtral/, "pixtral"], [/^devstral/, "devstral"], [/^mixtral/, "mixtral"],
    [/^(?:meta-)?llama-?guard/i, "llama-guard"], [/^codellama/i, "codellama"],
    [/^(?:meta-)?(llama-\d+\.?\d*)/i, null],
    [/^(qwen\d*\.?\d*)/, null], [/^qwq/, "qwq"],
    [/^command-a/, "command-a"], [/^command-r-plus/, "command-r-plus"],
    [/^command-r\d*/, "command-r"], [/^command/, "command"],
    [/^c4ai-aya/, "aya"], [/^embed/, "embed"], [/^rerank/, "rerank"],
    [/^(imagen-\d+\.?\d*)/i, null], [/^imagen/i, "imagen"],
    [/^(veo-\d+\.?\d*)/i, null], [/^gemini-embedding/, "gemini-embedding"],
    [/^deep-research/, "deep-research"],
    [/^(glm-\d+\.?\d*)/i, null], [/^glm/i, "glm"],
    [/^minimax/i, "minimax"], [/^mimo/i, "mimo"],
    [/^(kimi-k\d+\.?\d*)/i, null], [/^kimi/i, "kimi"],
    [/^(moonshot-v\d+)/i, null], [/^moonshot/i, "moonshot"],
    [/^magistral/, "magistral"], [/^mistral-nemo/, "mistral-nemo"],
    [/^mistral-saba/, "mistral-saba"], [/^mistral-7b/, "mistral-7b"],
    [/^mistral-embed/, "mistral-embed"], [/^mistral-moderation/, "mistral-moderation"],
    [/^voxtral/, "voxtral"], [/^dall-e/, "dall-e"], [/^sora-2/, "sora-2"],
    [/^text-embedding/, "text-embedding"], [/^omni-moderation/, "omni-moderation"],
    [/^text-moderation/, "text-moderation"], [/^tts/, "tts"], [/^gpt-4\.5/, "gpt-4.5"],
    [/^(wan\d*\.?\d*)/i, null], [/^wanx/, "wanx"],
    [/^sonar/, "sonar"], [/^compound/, "compound"], [/^whisper/, "whisper"],
  ];
  for (const [re, fixed] of rules) { const m = name.match(re); if (m) return fixed ?? m[1]; }
  return undefined;
}

// ── Parameter inference ──

export function inferParameters(modelId: string): { parameters: number; active_parameters?: number } | undefined {
  const id = modelId.toLowerCase();
  const moe = id.match(/(\d+)b[\s_-]*a(\d+)b/i);
  if (moe) return { parameters: Number(moe[1]), active_parameters: Number(moe[2]) };
  const std = id.match(/(?:^|[-_])(\d+(?:\.\d+)?)b(?:[-_]|$)/i);
  if (std) return { parameters: Number(std[1]) };
  return undefined;
}

// ── Model type inference ──

export function inferModelType(modelId: string, endpoints?: string[]): string | undefined {
  const raw = modelId.toLowerCase();
  const slashIdx = raw.indexOf("/");
  const stripped = slashIdx !== -1 ? raw.slice(slashIdx + 1) : raw;
  const prefixMatch = stripped.match(/^([a-z]+)\./);
  const id = prefixMatch ? stripped.slice(prefixMatch[0].length) : stripped;
  if (/^text-embedding|embed/i.test(id)) return "embed";
  if (/^(dall-e|chatgpt-image|gpt-image|stable-diffusion|flux|sdxl|imagen)/i.test(id)) return "image";
  if (/^grok-imagine/i.test(id)) return "image";
  if (/^recraft/i.test(id)) return "image";
  if (/^wanx?[\d.]+-t2i|^wanx?[\d.]+-image/i.test(id)) return "image";
  if (/^stable[-_](?:diffusion|image)|^sd\d/i.test(id)) return "image";
  if (/^titan[-_]image/i.test(id)) return "image";
  if (/^nova[-_]canvas/i.test(id)) return "image";
  if (/^stable[-_](?:outpaint|style|conservative|creative|fast)/i.test(id)) return "image";
  if (/^titan[-_]e/i.test(id)) return "embed";
  if (/^(sora|veo|seedance|kling)/i.test(id)) return "video";
  if (/^wanx?[\d.]+-(?:t2v|i2v|kf2v|r2v|s2v|vace|animate)/i.test(id)) return "video";
  if (/^nova[-_]reel|^ray[-_]v/i.test(id)) return "video";
  if (/^pegasus/i.test(id)) return "video";
  if (/^tts-|[-_]tts(?:[-_]|$)/i.test(id)) return "tts";
  if (/^orpheus/i.test(id)) return "tts";
  if (/^lyria/i.test(id)) return "tts";
  if (/^nova[-_]sonic|^voxtral/i.test(id)) return "audio";
  if (/^deep-research/i.test(id)) return "reasoning";
  if (/^whisper|transcribe|^asr/i.test(id)) return "transcription";
  if (/moderation/i.test(id)) return "moderation";
  if (/rerank/i.test(id)) return "rerank";
  if (/^codestral|^devstral|^codellama|^codex/i.test(id)) return "code";
  if (/^grok-code/i.test(id)) return "code";
  if (/(?<!non-)reasoning/i.test(id)) return "reasoning";
  if (/realtime/i.test(id)) return "audio";
  if (/search/i.test(id)) return "chat";
  if (/translate/i.test(id)) return "translation";
  if (/^qwen.*coder/i.test(id)) return "code";
  if (/^qwen.*omni/i.test(id)) return "chat";
  if (/^command|^c4ai-aya|^qwen/i.test(id)) return "chat";
  if (/^nova[-_](?:pro|lite|micro|premier|2)/i.test(id)) return "chat";
  if (/^(?:meta-)?llama|^jamba|^palmyra|^mixtral|^mistral|^ministral|^pixtral/i.test(id)) return "chat";
  if (/^titan[-_]t/i.test(id)) return "chat";
  if (/^glm|^kimi|^nemotron|^minimax|^gpt-oss|^m\d+-/i.test(id)) return "chat";
  if (/^claude/i.test(id)) return "chat";
  if (/^gemma/i.test(id)) return "chat";
  if (/^gemini/i.test(id)) return "chat";
  if (/^grok/i.test(id)) return "chat";
  if (/^wan.*(?:t2i|image)/i.test(id)) return "image";
  if (/^wan/i.test(id)) return "video";
  if (/^sonar/i.test(id)) return "chat";
  if (/^moonshot/i.test(id)) return "chat";
  if (/^deepseek[-_]v\d|^deepseek[-_]chat/i.test(id)) return "chat";
  if (/^r1|^v3/i.test(id)) return "chat";
  if (/^gpt-\d|^gpt[-_]audio/i.test(id)) return "chat";
  if (/^cogito|^granite|^lfm|^rnj|^mimo|^phi|^falcon/i.test(id)) return "chat";
  if (/^computer-use/i.test(id)) return "chat";
  if (/^ultravox/i.test(id)) return "audio";
  if (/^cogview/i.test(id)) return "image";
  if (/^cogvideo/i.test(id)) return "video";
  if (/^tts$|^tts-/i.test(id)) return "tts";
  if (/^composer/i.test(id)) return "chat";
  if (/^(o\d+)(?:-|$)/.test(id)) return "reasoning";
  if (/^deepseek-r\d/i.test(id)) return "reasoning";
  if (/^qwq/i.test(id)) return "reasoning";
  if (/^kimi.*thinking|^magistral/i.test(id)) return "reasoning";
  if (/guard|safeguard/i.test(id)) return "moderation";
  if (endpoints?.includes("embeddings") && !endpoints.includes("chat_completions")) return "embed";
  return undefined;
}

// ── Pricing helper ──

export function buildPricing(source: {
  input?: number | null; output?: number | null; cached_input?: number | null;
  cache_write?: number | null; batch_input?: number | null; batch_output?: number | null;
  tiers?: unknown;
}): Record<string, unknown> | undefined {
  const p: Record<string, unknown> = {};
  if (source.input != null) p.input = source.input;
  if (source.output != null) p.output = source.output;
  if (source.cached_input != null) p.cached_input = source.cached_input;
  if (source.cache_write != null) p.cache_write = source.cache_write;
  if (source.batch_input != null) p.batch_input = source.batch_input;
  if (source.batch_output != null) p.batch_output = source.batch_output;
  if (source.tiers != null) p.tiers = source.tiers;
  return Object.keys(p).length > 0 ? p : undefined;
}

// ── Upsert ──

import type { ModelData } from "../src/types.js";

export type ModelEntry = Omit<Partial<ModelData>, "id"|"name"|"source"|"last_updated"|"pricing"> & {
  id: string; name: string; pricing?: Record<string, unknown>;
};

const GENERATED_SKIP = new Set(["id","created_by","source","last_updated","_generated","snapshots","alias"]);

// Cache original on-disk state per model
const _originalOnDisk = new Map<string, { data: Record<string, unknown>; raw: string }>();

function getOriginal(provider: string, modelId: string): Record<string, unknown> | null {
  const key = `${provider}/${modelId}`;
  if (_originalOnDisk.has(key)) return _originalOnDisk.get(key)!.data;
  const fp = path.join(getProvidersDir(), provider, "models", `${modelId}.json`);
  if (!fs.existsSync(fp)) return null;
  const raw = fs.readFileSync(fp, "utf-8");
  const data = JSON.parse(raw) as Record<string, unknown>;
  _originalOnDisk.set(key, { data: JSON.parse(JSON.stringify(data)), raw });
  return data;
}

export function upsertModel(provider: string, entry: ModelEntry): boolean {
  recordUpsertAttempt();
  const modelId = sanitizeModelId(entry.id);
  const existing = readModelJson(provider, modelId);
  getOriginal(provider, modelId);
  if (existing && existing.source === "community") { console.log(`  skip ${modelId} (community)`); return false; }
  const generated = (existing?._generated as Record<string, string>) ?? {};
  const data: Record<string, unknown> = existing ? { ...existing } : {};
  data.id = entry.id;
  const existingName = existing?.name as string | undefined;
  const isRawId = entry.name === entry.id;
  data.name = isRawId && existingName && existingName !== entry.id ? existingName : entry.name;
  data.created_by = entry.created_by ?? (existing?.created_by as string) ?? provider;
  data.source = "official";
  const scalars = ["family","description","status","release_date","deprecation_date","retirement_date",
    "knowledge_cutoff","training_data_cutoff","context_window","max_context_window","max_output_tokens",
    "batch_max_output_tokens","max_input_tokens","model_type","license","parameters","active_parameters",
    "performance","reasoning","speed","page_url","tagline","architecture","alias"];
  for (const k of scalars) { if (entry[k as keyof ModelEntry] !== undefined) data[k] = entry[k as keyof ModelEntry]; }
  if (entry.capabilities) data.capabilities = entry.capabilities;
  if (entry.modalities) data.modalities = entry.modalities;
  if (entry.pricing) data.pricing = entry.pricing;
  if (entry.endpoints) data.endpoints = entry.endpoints;
  if (entry.tools) data.tools = entry.tools;
  if (entry.snapshots) data.snapshots = entry.snapshots;
  if (entry.successor) data.successor = entry.successor;
  if (entry.pricing_notes) data.pricing_notes = entry.pricing_notes;
  if (entry.reasoning_tokens !== undefined) data.reasoning_tokens = entry.reasoning_tokens;
  if (entry.open_weight !== undefined) data.open_weight = entry.open_weight;
  data.last_updated = today();
  data._generated = Object.fromEntries(
    Object.entries(data).filter(([k]) => !GENERATED_SKIP.has(k)).map(([k, v]) => [k, hashValue(v)])
  );
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  const disk = existing ? `${JSON.stringify(existing, null, 2)}\n` : "";
  if (serialized === disk) { console.log(`  skip ${modelId} (unchanged)`); return false; }
  writeModelJson(provider, modelId, data);
  return true;
}

export function upsertWithSnapshot(provider: string, entry: ModelEntry): number {
  let written = upsertModel(provider, entry) ? 1 : 0;
  const snapshots = entry.snapshots as string[] | undefined;
  if (!snapshots?.length) return written;
  for (const snapId of snapshots) {
    const existingSnap = readModelJson(provider, snapId);
    const snapEntry: ModelEntry = {
      id: snapId, name: `${entry.name} (${snapId.split("-").pop()})`,
      family: entry.family, model_type: entry.model_type, status: "deprecated",
      alias: entry.id, created_by: entry.created_by,
    };
    if (existingSnap) {
      for (const k of ["context_window","max_output_tokens","capabilities","modalities","pricing","endpoints","tools"])
        if (existingSnap[k] != null) (snapEntry as Record<string,unknown>)[k] = existingSnap[k];
    }
    if (upsertModel(provider, snapEntry)) written++;
  }
  return written;
}
