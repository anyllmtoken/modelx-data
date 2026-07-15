import { fetchText } from "./parse.ts";
import {
  type ModelEntry,
  runGenerate,
  setRegion,
  upsertWithSnapshot,
  inferModelType,
  inferFamily,
} from "./shared.ts";

setRegion("cn");

function parseMdTable(md: string): string[][] {
  const rows: string[][] = [];
  const lines = md.split("\n");
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) { inTable = false; continue; }
    if (trimmed.includes("---")) { inTable = true; continue; }
    if (!inTable) continue;
    const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

function parsePrice(s: string): number {
  const m = s.match(/([\d.]+)/);
  return m ? Number(m[1]) : 0;
}

async function main() {
  console.log("Fetching StepFun models with CNY pricing...");

  const md = await fetchText(
    "https://platform.stepfun.com/docs/zh/guides/pricing/details.md",
  );

  const sections = md.split("### ");
  let written = 0;
  const seen = new Set<string>();

  for (const section of sections) {
    const rows = parseMdTable(section);

    if (
      section.includes("推理大模型") ||
      section.includes("多模态推理") ||
      section.includes("视觉大模型")
    ) {
      // LLM rows: | model | context | input | cache | output |
      for (const r of rows) {
        const name = (r[0] ?? "").replace(/`/g, "").trim();
        if (!name.startsWith("step")) continue;
        if (seen.has(name)) continue;
        seen.add(name);

        const input = parsePrice(r[2] ?? "0");
        const cache = parsePrice(r[3] ?? "0");
        const output = parsePrice(r[4] ?? "0");

        const pricing: Record<string, unknown> = {
          input,
          output,
        };
        if (cache > 0) pricing.cached_input = cache;

        const entry: ModelEntry = {
          id: name,
          name,
          created_by: "stepfun",
          family: inferFamily(name) ?? "stepfun",
          model_type: inferModelType(name) ?? "chat",
          pricing,
          capabilities: { streaming: true, tool_call: true, structured_output: true },
          modalities: { input: ["text"], output: ["text"] },
        };

        written += upsertWithSnapshot("stepfun", entry) ? 1 : 0;
      }
    } else if (section.includes("语音模型")) {
      for (const r of rows) {
        const cell0 = (r[0] ?? "").replace(/`/g, "").trim();
        if (!cell0.startsWith("step")) continue;

        // Skip voice clone entries
        if (cell0.includes("/") && !cell0.includes("step")) continue;
        const name = cell0.split("/")[0]?.trim() ?? cell0;

        if (seen.has(name)) continue;
        seen.add(name);

        const price = parsePrice(r[2] ?? "0");
        const isTTS = name.includes("tts");
        const isASR = name.includes("asr") || name.includes("whisper");

        const entry: ModelEntry = {
          id: name,
          name,
          created_by: "stepfun",
          family: inferFamily(name) ?? "stepfun",
          model_type: isTTS ? "tts" : isASR ? "transcription" : ("chat" as ModelEntry["model_type"]),
          pricing: price > 0 ? { input: price } : undefined,
          capabilities: { streaming: true },
          modalities: {
            input: isASR ? ["audio"] : ["text"],
            output: isTTS ? ["audio"] : ["text"],
          },
        };

        written += upsertWithSnapshot("stepfun", entry) ? 1 : 0;
      }
    } else if (section.includes("文生图") || section.includes("Step 1X")) {
      for (const r of rows) {
        const name = (r[0] ?? "").replace(/`/g, "").trim();
        if (!name.startsWith("step")) continue;
        if (seen.has(name)) continue;
        seen.add(name);

        const price = parsePrice(r[2] ?? r[1] ?? "0");

        const entry: ModelEntry = {
          id: name,
          name,
          created_by: "stepfun",
          family: inferFamily(name) ?? "stepfun",
          model_type: "image",
          pricing: price > 0 ? { input: price } : undefined,
          capabilities: { streaming: true },
          modalities: { input: ["text", "image"], output: ["image"] },
        };

        written += upsertWithSnapshot("stepfun", entry) ? 1 : 0;
      }
    }
  }

  console.log(`Parsed ${seen.size} unique models, wrote ${written}`);
  runGenerate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
