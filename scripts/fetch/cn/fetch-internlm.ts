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
 * InternLM (书生) model data.
 * Shanghai AI Lab — open-source LLM + VLM, limited commercial API presence.
 */

interface ModelSpec {
  id: string;
  name: string;
  model_type: "chat" | "code";
  vision?: boolean;
  parameters?: number;
  context_window?: number;
  open_weight: boolean;
  license: string;
  description: string;
}

const MODELS: ModelSpec[] = [
  // InternLM3 series
  {
    id: "internlm3-8b", name: "InternLM3-8B",
    model_type: "chat", parameters: 8, context_window: 32768,
    open_weight: true, license: "apache-2.0",
    description: "上海AI Lab 第三代基座大模型，8B 参数",
  },
  {
    id: "internlm3-8b-instruct", name: "InternLM3-8B-Instruct",
    model_type: "chat", parameters: 8, context_window: 32768,
    open_weight: true, license: "apache-2.0",
    description: "InternLM3-8B 指令微调版本",
  },

  // InternLM2 series
  {
    id: "internlm2-20b", name: "InternLM2-20B",
    model_type: "chat", parameters: 20, context_window: 32768,
    open_weight: true, license: "apache-2.0",
    description: "书生浦语 2.0，200 亿参数基座模型",
  },
  {
    id: "internlm2-20b-instruct", name: "InternLM2-20B-Instruct",
    model_type: "chat", parameters: 20, context_window: 32768,
    open_weight: true, license: "apache-2.0",
    description: "InternLM2-20B 对话微调版本",
  },
  {
    id: "internlm2-7b", name: "InternLM2-7B",
    model_type: "chat", parameters: 7, context_window: 32768,
    open_weight: true, license: "apache-2.0",
    description: "书生浦语 2.0，70 亿参数",
  },
  {
    id: "internlm2-7b-instruct", name: "InternLM2-7B-Instruct",
    model_type: "chat", parameters: 7, context_window: 32768,
    open_weight: true, license: "apache-2.0",
    description: "InternLM2-7B 对话微调版本",
  },

  // InternVL (vision-language) series
  {
    id: "internvl3-8b", name: "InternVL3-8B",
    model_type: "chat", parameters: 8, context_window: 128000, vision: true,
    open_weight: true, license: "apache-2.0",
    description: "多模态视觉语言模型，8B 参数，支持 128K 上下文",
  },
  {
    id: "internvl3-38b", name: "InternVL3-38B",
    model_type: "chat", parameters: 38, context_window: 128000, vision: true,
    open_weight: true, license: "apache-2.0",
    description: "多模态视觉语言模型，38B 参数",
  },
  {
    id: "internvl3-78b", name: "InternVL3-78B",
    model_type: "chat", parameters: 78, context_window: 128000, vision: true,
    open_weight: true, license: "apache-2.0",
    description: "多模态视觉语言模型，78B 参数",
  },
  {
    id: "internvl3-256b", name: "InternVL3-256B",
    model_type: "chat", parameters: 256, context_window: 128000, vision: true,
    open_weight: false, license: "proprietary",
    description: "千亿级多模态视觉语言模型，256B 参数",
  },

  // Code
  {
    id: "internlm3-code-8b", name: "InternLM3-Code-8B",
    model_type: "code", parameters: 8, context_window: 32768,
    open_weight: true, license: "apache-2.0",
    description: "InternLM3 代码生成模型",
  },
];

async function main() {
  console.log(`Fetching InternLM models... (${MODELS.length} without pricing)`);
  let written = 0;

  for (const spec of MODELS) {
    const capabilities: Record<string, boolean> = { streaming: true };
    if (spec.model_type === "chat") {
      capabilities.tool_call = true;
      capabilities.structured_output = true;
    }

    const modalities: { input: string[]; output: string[] } = { input: ["text"], output: ["text"] };
    if (spec.vision) modalities.input.push("image");

    const entry: ModelEntry = {
      id: spec.id,
      name: spec.name,
      created_by: "internlm",
      family: inferFamily(spec.id) ?? "internlm",
      model_type: spec.model_type,
      context_window: spec.context_window,
      parameters: spec.parameters,
      description: spec.description,
      license: spec.license,
      open_weight: spec.open_weight,
      capabilities,
      modalities,
    };

    written += upsertWithSnapshot("internlm", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => { console.error(err); process.exit(1); });
