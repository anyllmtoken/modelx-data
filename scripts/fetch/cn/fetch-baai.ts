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
 * BAAI (智源研究院) model data.
 * BAAI is a research institute — no commercial API / pricing.
 * Models are open-source, listed for catalog completeness.
 */

interface ModelSpec {
  id: string;
  name: string;
  model_type: "chat" | "embed" | "image" | "code";
  vision?: boolean;
  open_weight: boolean;
  license: string;
  description: string;
  parameters?: number;
  context_window?: number;
}

const MODELS: ModelSpec[] = [
  {
    id: "aquila2-34b", name: "Aquila2-34B",
    model_type: "chat", open_weight: true, license: "apache-2.0",
    parameters: 34, context_window: 32768,
    description: "BAAI 自主研发的千亿级开源大语言模型",
  },
  {
    id: "aquila2-7b", name: "Aquila2-7B",
    model_type: "chat", open_weight: true, license: "apache-2.0",
    parameters: 7, context_window: 32768,
    description: "BAAI 轻量级开源大语言模型",
  },
  {
    id: "aquilachat-34b", name: "AquilaChat-34B",
    model_type: "chat", open_weight: true, license: "apache-2.0",
    parameters: 34, context_window: 8192,
    description: "Aquila2-34B 的对话微调版本",
  },
  {
    id: "aquilachat-7b", name: "AquilaChat-7B",
    model_type: "chat", open_weight: true, license: "apache-2.0",
    parameters: 7, context_window: 8192,
    description: "Aquila2-7B 的对话微调版本",
  },
  {
    id: "aquilacode-34b", name: "AquilaCode-34B",
    model_type: "code", open_weight: true, license: "apache-2.0",
    parameters: 34, context_window: 16384,
    description: "BAAI 代码生成大模型",
  },
  {
    id: "bge-large-zh-v1.5", name: "BGE-Large-ZH-v1.5",
    model_type: "embed", open_weight: true, license: "apache-2.0",
    parameters: 0.33, context_window: 512,
    description: "中文语义向量模型，支持检索、分类、聚类",
  },
  {
    id: "bge-large-en-v1.5", name: "BGE-Large-EN-v1.5",
    model_type: "embed", open_weight: true, license: "apache-2.0",
    parameters: 0.33, context_window: 512,
    description: "英文语义向量模型",
  },
  {
    id: "bge-m3", name: "BGE-M3",
    model_type: "embed", open_weight: true, license: "apache-2.0",
    parameters: 0.57, context_window: 8192,
    description: "多语言向量模型，支持 100+ 语言",
  },
  {
    id: "bge-reranker-v2-m3", name: "BGE-Reranker-v2-M3",
    model_type: "embed", open_weight: true, license: "apache-2.0",
    parameters: 0.57,
    description: "多语言 Reranker 模型",
  },
  {
    id: "emu2", name: "Emu2",
    model_type: "image", open_weight: true, license: "mit",
    parameters: 37, vision: true,
    description: "多模态理解与生成统一大模型",
  },
];

const MTYPE_TO_CAP = {
  chat: { streaming: true, tool_call: true },
  code: { streaming: true, tool_call: true },
  embed: {},
  image: {},
} as Record<string, Record<string, boolean>>;

async function main() {
  console.log(`Fetching BAAI models... (${MODELS.length} without pricing)`);
  let written = 0;

  for (const spec of MODELS) {
    const caps = MTYPE_TO_CAP[spec.model_type] ?? {};
    const modalities: { input: string[]; output: string[] } = { input: ["text"], output: ["text"] };
    if (spec.vision) modalities.input.push("image");
    if (spec.model_type === "image") modalities.output = ["image"];

    const entry: ModelEntry = {
      id: spec.id,
      name: spec.name,
      created_by: "baai",
      family: inferFamily(spec.id) ?? "baai",
      model_type: spec.model_type,
      context_window: spec.context_window,
      parameters: spec.parameters,
      description: spec.description,
      license: spec.license,
      open_weight: spec.open_weight,
      capabilities: caps,
      modalities,
    };

    written += upsertWithSnapshot("baai", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => { console.error(err); process.exit(1); });
