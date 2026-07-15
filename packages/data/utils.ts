import type { Model, ProviderWithModels } from "./types";

/**
 * 按 provider + model id 精确查找单个模型。
 * @example getModel(providers, allModels, "openai", "gpt-4o")
 */
export function getModel(
  providers: ProviderWithModels[],
  allModels: Model[],
  provider: string,
  id: string,
): Model | undefined {
  return allModels.find((m) => m.provider === provider && m.id === id);
}

/**
 * 获取某个 provider 下的所有模型。
 * @example getModelsByProvider(providers, allModels, "deepseek")
 */
export function getModelsByProvider(
  providers: ProviderWithModels[],
  allModels: Model[],
  provider: string,
): Model[] {
  return allModels.filter((m) => m.provider === provider);
}

/**
 * 获取所有非 deprecated 的活跃模型。
 * @example getActiveModels(providers, allModels)
 */
export function getActiveModels(
  providers: ProviderWithModels[],
  allModels: Model[],
): Model[] {
  return allModels.filter((m) => m.status !== "deprecated");
}

/**
 * 按 model family 过滤模型。
 * @example getModelsByFamily(providers, allModels, "gpt-4o")
 */
export function getModelsByFamily(
  providers: ProviderWithModels[],
  allModels: Model[],
  family: string,
): Model[] {
  return allModels.filter((m) => m.family === family);
}

/**
 * 按创建者过滤模型。
 * @example getModelsByCreator(providers, allModels, "google")
 */
export function getModelsByCreator(
  providers: ProviderWithModels[],
  allModels: Model[],
  creator: string,
): Model[] {
  return allModels.filter((m) => m.created_by === creator);
}

/**
 * 按 id 查找单个 provider。
 * @example getProvider(providers, "openai")
 */
export function getProvider(
  providers: ProviderWithModels[],
  id: string,
): ProviderWithModels | undefined {
  return providers.find((p) => p.id === id);
}

/**
 * 获取全部 provider 列表。
 * @example getAllProviders(providers)
 */
export function getAllProviders(
  providers: ProviderWithModels[],
): ProviderWithModels[] {
  return providers;
}

/**
 * 获取 provider 的内联 SVG 图标字符串。
 * @example getProviderIcon(providers, "openai")
 */
export function getProviderIcon(
  providers: ProviderWithModels[],
  id: string,
): string | undefined {
  return providers.find((p) => p.id === id)?.icon;
}
