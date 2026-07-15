import {
  type ModelEntry,
  runGenerate,
  setRegion,
  upsertWithSnapshot,
  inferModelType,
  inferFamily,
} from "./shared.ts";

setRegion("cn");

/**
 * Skywork (天工) model data.
 * Skywork by Kunlun Tech — open-source models, no commercial API with published pricing.
 */

interface ModelSpec {
  id: string;
  name: string;
  model_type: "chat" | "code";
  parameters?: number;
  context_window?: number;
  moe?: boolean;
  open_weight: boolean;
  license: string;
  description: string;
}

const MODELS: ModelSpec[] = [
  {
    id: "skywork-13b", name: "Skywork-13B",
    model_type: "chat", parameters: 13, context_window: 4096,
    open_weight: true, license: "skywork-1.0",
    description: "天工系列基座大模型，130 亿参数",
  },
  {
    id: "skywork-13b-chat", name: "Skywork-13B-Chat",
    model_type: "chat", parameters: 13, context_window: 4096,
    open_weight: true, license: "skywork-1.0",
    description: "Skywork-13B 对话微调版本",
  },
  {
    id: "skywork-13b-128k", name: "Skywork-13B-128K",
    model_type: "chat", parameters: 13, context_window: 131072,
    open_weight: true, license: "skywork-1.0",
    description: "支持 128K 长上下文的 Skywork 模型",
  },
  {
    id: "skywork-moe", name: "Skywork-MoE",
    model_type: "chat", parameters: 75, moe: true,
    open_weight: true, license: "skywork-1.0",
    description: "基于 MoE 架构的高效大模型，总参数量 75B",
  },
  {
    id: "skywork-coder-1.5b", name: "Skywork-Coder-1.5B",
    model_type: "code", parameters: 1.5, context_window: 8192,
    open_weight: true, license: "skywork-1.0",
    description: "轻量级代码生成模型",
  },
  {
    id: "skywork-coder-7b", name: "Skywork-Coder-7B",
    model_type: "code", parameters: 7, context_window: 16384,
    open_weight: true, license: "skywork-1.0",
    description: "代码生成大模型",
  },
];

const CAPS: Record<string, Record<string, boolean>> = {
  chat: { streaming: true, tool_call: true },
  code: { streaming: true },
};

async function main() {
  console.log(`Fetching Skywork models... (${MODELS.length} without pricing)`);
  let written = 0;

  for (const spec of MODELS) {
    const entry: ModelEntry = {
      id: spec.id,
      name: spec.name,
      created_by: "skywork",
      family: inferFamily(spec.id) ?? "skywork",
      model_type: spec.model_type,
      context_window: spec.context_window,
      parameters: spec.parameters,
      description: spec.description,
      license: spec.license,
      open_weight: spec.open_weight,
      capabilities: CAPS[spec.model_type] ?? { streaming: true },
      modalities: { input: ["text"], output: ["text"] },
    };

    written += upsertWithSnapshot("skywork", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => { console.error(err); process.exit(1); });
