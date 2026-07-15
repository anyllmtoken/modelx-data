// @anyllmtoken/modelx-data — Model data for all providers across CN and US regions
//
//   import { getProviders, getAllModels, getChanges, getModel } from "@anyllmtoken/modelx-data";

import { providers as _providersUs, allModels as _allModelsUs } from "./data-us";
import { providers as _providersCn, allModels as _allModelsCn } from "./data-cn";
import {
  getModel as _getModel,
  getModelsByProvider as _getModelsByProvider,
  getActiveModels as _getActiveModels,
  getModelsByFamily as _getModelsByFamily,
  getModelsByCreator as _getModelsByCreator,
  getProvider as _getProvider,
  getAllProviders as _getAllProviders,
  getProviderIcon as _getProviderIcon,
} from "./utils";
import type { Model, ProviderWithModels } from "./types";

// ── 类型 ──

export type {
  Model,
  ModelData,
  ModelPricing,
  ModelCapabilities,
  ModelModalities,
  Provider,
  ProviderWithModels,
  PricingTier,
  PricingTierRow,
  ModelStatus,
  ModelSource,
  Modality,
} from "./types";

// ── 合并双区域数据 ──

function tagRegion<T extends { id: string }>(items: T[], r: string): (T & { region: string })[] {
  return items.map((m) => ({ ...m, region: r }));
}

const cnProviders = _providersCn.map((p) => ({
  ...p,
  models: tagRegion(p.models, "CN"),
}));

const usProviders = _providersUs.map((p) => ({
  ...p,
  models: tagRegion(p.models, "US"),
}));

const allProviders = [...usProviders, ...cnProviders];

export function getProviders(): ProviderWithModels[] {
  const map = new Map<string, ProviderWithModels>();
  for (const p of allProviders) {
    if (map.has(p.id)) {
      map.get(p.id)!.models.push(...p.models);
    } else {
      map.set(p.id, { ...p, models: [...p.models] });
    }
  }
  return [...map.values()];
}

const _allModels: (Model & { region: string })[] = [
  ...tagRegion(_allModelsUs, "US"),
  ...tagRegion(_allModelsCn, "CN"),
];

export function getModels(): (Model & { region: string })[] {
  return _allModels;
}

// ── 查询 ──

export function getModel(provider: string, id: string): (Model & { region: string }) | undefined {
  return _getModel(allProviders, _allModels, provider, id) as any;
}
export function getModelsByProvider(provider: string): (Model & { region: string })[] {
  return _getModelsByProvider(allProviders, _allModels, provider) as any;
}
export function getActiveModels(): (Model & { region: string })[] {
  return _getActiveModels(allProviders, _allModels) as any;
}
export function getModelsByFamily(family: string): (Model & { region: string })[] {
  return _getModelsByFamily(allProviders, _allModels, family) as any;
}
export function getModelsByCreator(creator: string): (Model & { region: string })[] {
  return _getModelsByCreator(allProviders, _allModels, creator) as any;
}
export function getProvider(id: string): ProviderWithModels | undefined {
  const first = allProviders.find((p) => p.id === id);
  if (!first) return undefined;
  // Merge all entries with same id into one
  const all = allProviders.filter((p) => p.id === id);
  return { ...first, models: all.flatMap((p) => p.models) };
}
export function getAllProviders(): ProviderWithModels[] {
  // Deduplicate by id, merge models
  const map = new Map<string, ProviderWithModels>();
  for (const p of allProviders) {
    if (map.has(p.id)) {
      map.get(p.id)!.models.push(...p.models);
    } else {
      map.set(p.id, { ...p, models: [...p.models] });
    }
  }
  return [...map.values()];
}
export function getProviderIcon(id: string): string | undefined {
  return _getProviderIcon(allProviders, id);
}

// ── 变更日志 ──

export interface ChangeEntry {
  ts: string;
  provider: string;
  model: string;
  action: "create" | "update" | "delete";
  commit?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

const _loadChanges = (): ChangeEntry[] => {
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { fileURLToPath } = require("node:url") as typeof import("node:url");
    const { resolve, dirname } = require("node:path") as typeof import("node:path");
    const d = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
    const content = readFileSync(resolve(d, "changes.jsonl"), "utf-8");
    return content.trim().split("\n").filter(Boolean).map((l: string) => JSON.parse(l)).reverse();
  } catch {
    return [];
  }
};

export function getChanges(): ChangeEntry[] {
  return _loadChanges();
}
