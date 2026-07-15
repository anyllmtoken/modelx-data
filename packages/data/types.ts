/** Model lifecycle status */
export type ModelStatus = "active" | "deprecated" | "preview";

export type ModelSource = "official" | "community";

export type Modality = "text" | "image" | "audio" | "video";

export interface ModelCapabilities {
  vision?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  reasoning?: boolean;
  json_mode?: boolean;
  streaming?: boolean;
  fine_tuning?: boolean;
  batch?: boolean;
  prompt_caching?: boolean;
}

export interface ModelModalities {
  input?: Modality[];
  output?: Modality[];
}

export interface ModelPricing {
  input?: number | null;
  output?: number | null;
  cached_input?: number | null;
  cache_write?: number | null;
  cache_write_1h?: number | null;
  batch_input?: number | null;
  batch_output?: number | null;
  /** Cost per 1M cached output tokens (reasoning models) */
  cached_output?: number | null;
  /** Detailed pricing breakdown by category (text/audio/image tokens, per-image, etc.) */
  tiers?: PricingTier[];
  /** Provider-specific pricing fields (e.g. cosy_tts_number) */
  [key: string]: unknown;
}

export interface PricingTier {
  label: string;
  unit: string;
  columns: string[];
  rows: PricingTierRow[];
}

export interface PricingTierRow {
  label: string;
  values: (number | null)[];
}

export interface ModelData {
  id: string;
  name: string;
  created_by: string;
  source: ModelSource;
  last_updated: string;
  family?: string;
  description?: string;
  tagline?: string;
  page_url?: string;
  status?: ModelStatus;
  release_date?: string | null;
  deprecation_date?: string | null;
  retirement_date?: string | null;
  knowledge_cutoff?: string | null;
  context_window?: number | null;
  max_context_window?: number | null;
  max_output_tokens?: number | null;
  batch_max_output_tokens?: number | null;
  max_input_tokens?: number | null;
  capabilities?: ModelCapabilities;
  modalities?: ModelModalities;
  pricing?: ModelPricing;
  model_type?: "chat" | "reasoning" | "embed" | "embedding" | "rerank" | "image" | "video" | "audio" | "tts" | "transcription" | "moderation" | "code" | "translation" | "classification" | "other";
  tools?: string[];
  endpoints?: string[];
  reasoning_tokens?: boolean;
  license?: string;
  parameters?: number;
  active_parameters?: number;
  snapshots?: string[];
  alias?: string;
  performance?: number;
  reasoning?: number;
  speed?: number;
  successor?: string | string[];
  pricing_notes?: string[];
  training_data_cutoff?: string | null;
  architecture?: string;
  open_weight?: boolean;
  [key: string]: unknown;
}

export interface Model extends ModelData {
  provider: string;
}

export type ProviderType = "direct" | "aggregator" | "cloud";

export interface Provider {
  id: string;
  name: string;
  description?: string;
  type?: ProviderType;
  aliases?: string[];
  region: string;
  headquarters?: string;
  founded?: number;
  url: string;
  api_url: string | null;
  docs_url: string;
  pricing_url: string | null;
  playground_url?: string;
  status_url?: string;
  changelog_url?: string;
  sdk?: Record<string, string>;
  free_tier?: boolean;
  pricing_currency?: string;
  openai_compatible?: boolean;
  github_url?: string;
  models_url?: string;
  tokenizer_url?: string;
  twitter_url?: string;
  discord_url?: string;
  blog_url?: string;
  terms_url?: string;
  support_url?: string;
  icon?: string;
}

export interface ChangeEntry {
  ts: string;
  provider: string;
  model: string;
  action: "create" | "update" | "delete";
  commit?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export interface ProviderWithModels extends Provider {
  models: ModelData[];
}
