# ModelX Data

> 跨提供商 AI 模型数据管道 — 60+ 提供商的规格、定价和能力数据。

---

## 概述

`modelx-data` 是数据管道，从各 AI 提供商的官方文档网站抓取模型定价、能力和规格数据，生成结构化数据文件供 [modelx-web](https://github.com/anyllmtoken/modelx-web) 前端使用。

**功能：**

- **抓取** — 从 30+ CN/US 提供商官网爬取定价和模型规格
- **生成** — 产出 `src/data-cn.ts` 和 `src/data-us.ts`，带类型定义
- **变更检测** — 通过 git diff 追踪模型新增、价格变动和弃用
- **发布** — CI 每天自动运行，发布 `@anyllmtoken/modelx-data` 到 npm

---

## 使用

### 作为 npm 包

```bash
npm install @anyllmtoken/modelx-data
# 或
pnpm add @anyllmtoken/modelx-data
# 或
bun add @anyllmtoken/modelx-data
```

```typescript
import { getModels, getProviders, getChanges } from "@anyllmtoken/modelx-data";

// 所有模型（含区域标记）
const models = getModels();

// 所有提供商（含模型列表）
const providers = getProviders();

// 最近的变更记录
const changes = getChanges();

// 查询辅助
import { getModel, getProvider, getModelsByProvider } from "@anyllmtoken/modelx-data";
const model = getModel("openai", "gpt-4o");
```

---

## 开发

### 环境要求

- [Bun](https://bun.sh)（运行时）

### 安装

```bash
git clone <repo-url>
cd modelx-data
bun install
bunx playwright install chromium
```

### 运行抓取脚本

```bash
# CN 提供商
for f in scripts/fetch/cn/fetch-*.ts; do bun run "$f"; done

# US 提供商
for f in scripts/fetch/us/fetch-*.ts; do bun run "$f"; done
```

### 生成数据文件

```bash
bun run generate    # US 数据 → src/data-us.ts
bun run generate:cn # CN 数据 → src/data-cn.ts
```

---

## 项目结构

```
modelx-data/
├── scripts/
│   ├── fetch/cn/         # CN 提供商抓取脚本（20 个）
│   ├── fetch/us/         # US 提供商抓取脚本（49 个）
│   ├── generate.ts       # 代码生成
│   ├── shared.ts         # 共享工具函数
│   └── detect-changes.ts # 变更检测
├── providers/
│   ├── cn/               # CN 模型 JSON 文件
│   └── us/               # US 模型 JSON 文件
├── src/
│   ├── data-cn.ts        # 生成的 CN 数据
│   ├── data-us.ts        # 生成的 US 数据
│   ├── types.ts          # 类型定义
│   └── utils.ts          # 查询工具
├── packages/data/        # @anyllmtoken/modelx-data npm 包
└── .github/workflows/
    └── publish.yml       # 每日 CI 流程
```

---

## CI / 发布

GitHub Actions 每天 UTC 6:00 自动运行：

1. 运行所有抓取脚本（CN + US）
2. 生成数据文件
3. 检测变更
4. 如有变更：提交并发布 `@anyllmtoken/modelx-data` 到 npm

也支持手动触发。

---

## 支持提供商

**US（30+）**：OpenAI、Anthropic、Google AI、Meta、Mistral、Cohere、xAI、DeepSeek 等

**CN（20+）**：字节跳动（火山引擎）、智谱（GLM）、百度（千帆）、腾讯（混元）、360（智脑）、百川、商汤、阶跃星辰、阿里（百炼）等

---

## 许可证

MIT
