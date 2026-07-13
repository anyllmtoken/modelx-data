// @modelx/data — Model data for 51 providers, 7485+ models
//
//   import { getModel, providers, allModels } from "@modelx/data";

import { providers as _providers, allModels as _allModels } from "../../src/data-us";
import {
  getModel as _getModel,
  getModelsByProvider as _getModelsByProvider,
  getActiveModels as _getActiveModels,
  getModelsByFamily as _getModelsByFamily,
  getModelsByCreator as _getModelsByCreator,
  getProvider as _getProvider,
  getAllProviders as _getAllProviders,
  getProviderIcon as _getProviderIcon,
} from "../../src/utils";
import type { Model, ProviderWithModels } from "../../src/types";

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
  ModelType,
  Modality,
} from "../../src/types";

// ── 数据 ──

export const providers = _providers;
export const allModels = _allModels;

// ── 查询 ──

export function getModel(provider: string, id: string): Model | undefined {
  return _getModel(_providers, _allModels, provider, id);
}
export function getModelsByProvider(provider: string): Model[] {
  return _getModelsByProvider(_providers, _allModels, provider);
}
export function getActiveModels(): Model[] {
  return _getActiveModels(_providers, _allModels);
}
export function getModelsByFamily(family: string): Model[] {
  return _getModelsByFamily(_providers, _allModels, family);
}
export function getModelsByCreator(creator: string): Model[] {
  return _getModelsByCreator(_providers, _allModels, creator);
}
export function getProvider(id: string): ProviderWithModels | undefined {
  return _getProvider(_providers, id);
}
export function getAllProviders(): ProviderWithModels[] {
  return _getAllProviders(_providers);
}
export function getProviderIcon(id: string): string | undefined {
  return _getProviderIcon(_providers, id);
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

let _changes: ChangeEntry[] | null = null;

export function getChanges(): ChangeEntry[] {
  if (_changes) return _changes;
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const filePath = resolve(process.cwd(), "../modelx-data/packages/data/changes.jsonl");
    const content = readFileSync(filePath, "utf-8");
    const entries: ChangeEntry[] = content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line: string) => JSON.parse(line))
      .reverse();
    _changes = entries;
    return entries;
  } catch {
    return [];
  }
}
