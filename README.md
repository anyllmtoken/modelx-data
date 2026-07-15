# ModelX Data

> Cross-provider AI model data pipeline — specs, pricing, capabilities across 60+ providers.

[中文文档](README.zh-CN.md)

---

## Overview

`modelx-data` is the data pipeline. It scrapes AI model pricing, capabilities, and specs from official provider documentation websites and generates structured data files consumed by the [modelx-web](https://github.com/anyllmtoken/modelx-web) frontend.

**What it does:**

- **Fetch** — Scrapes pricing and model specs from 30+ CN and US provider sites (OpenAI, Anthropic, Google, DeepSeek, Zhipu, ByteDance, Tencent, Baidu, etc.)
- **Generate** — Produces `src/data-cn.ts` and `src/data-us.ts` containing all models in a typed format
- **Detect changes** — Tracks model additions, price updates, and deprecations via git diff
- **Publish** — CI pipeline runs daily, publishes `@anyllmtoken/modelx-data` to npm automatically

---

## Usage

### As an npm package

```bash
npm install @anyllmtoken/modelx-data
# or
pnpm add @anyllmtoken/modelx-data
# or
bun add @anyllmtoken/modelx-data
```

```typescript
import { getModels, getProviders, getChanges } from "@anyllmtoken/modelx-data";

// All models with region tags
const models = getModels();
console.log(models[0]); // { id: "gpt-4o", provider: "openai", region: "US", ... }

// All providers with their models
const providers = getProviders();
console.log(providers[0]); // { id: "openai", name: "OpenAI", models: [...], ... }

// Recent changes (additions, price updates, deprecations)
const changes = getChanges();
console.log(changes[0]); // { ts: "2026-07-15", action: "create", model: "glm-5.2", ... }

// Query helpers
import { getModel, getProvider, getModelsByProvider } from "@anyllmtoken/modelx-data";

const model = getModel("openai", "gpt-4o");
const provider = getProvider("openai");
const openaiModels = getModelsByProvider("openai");
```

---

## Development

### Prerequisites

- [Bun](https://bun.sh) (runtime)

### Setup

```bash
git clone <repo-url>
cd modelx-data
bun install
bunx playwright install chromium
```

### Run all fetch scripts

```bash
# CN providers
for f in scripts/fetch/cn/fetch-*.ts; do bun run "$f"; done

# US providers
for f in scripts/fetch/us/fetch-*.ts; do bun run "$f"; done
```

### Generate data files

```bash
bun run generate    # US data → src/data-us.ts
bun run generate:cn # CN data → src/data-cn.ts
```

### Detect changes

```bash
bun run changes
```

---

## Project Structure

```
modelx-data/
├── scripts/
│   ├── fetch/cn/         # CN provider fetch scripts (20 scripts)
│   ├── fetch/us/         # US provider fetch scripts (49 scripts)
│   ├── generate.ts       # Codegen: provider JSON → TypeScript data files
│   ├── shared.ts         # Shared fetch utilities
│   └── detect-changes.ts # Git-diff based change detection
├── providers/
│   ├── cn/               # CN provider model JSON files
│   └── us/               # US provider model JSON files
├── src/
│   ├── data-cn.ts        # Generated CN data
│   ├── data-us.ts        # Generated US data
│   ├── types.ts          # TypeScript type definitions
│   └── utils.ts          # Query utilities
├── packages/data/        # @anyllmtoken/modelx-data npm package
│   ├── index.ts          # Entry point
│   ├── package.json
│   └── changes.jsonl     # Change log
└── .github/workflows/
    └── publish.yml       # Daily CI: fetch → generate → publish
```

---

## CI / Publishing

A GitHub Action runs daily at 06:00 UTC:

1. Runs all fetch scripts (CN + US)
2. Generates `src/data-cn.ts` and `src/data-us.ts`
3. Detects changes via git diff
4. If data changed: commits and publishes `@anyllmtoken/modelx-data` to npm

Manual trigger also supported via `workflow_dispatch`.

---

## Supported Providers

**US (30+)**: OpenAI, Anthropic, Google AI, Meta, Mistral, Cohere, xAI, DeepSeek, etc.

**CN (20+)**: ByteDance (Volcengine), Zhipu (GLM), Baidu (Qianfan), Tencent (Hunyuan), 360 (Zhinao), Baichuan, SenseTime, StepFun, Alibaba (Bailian), etc.

---

## License

MIT

---
