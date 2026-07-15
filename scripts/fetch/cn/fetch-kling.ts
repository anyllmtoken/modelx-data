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
 * Kling (快手可灵) model pricing.
 * Source: https://klingai.com/document-api/pricing/base/video
 * 1积分 ≈ ¥1. Prices are per-generation (image or video).
 */

interface ModelSpec {
  id: string;
  name: string;
  price: number;
  video?: boolean;
}

const IMAGE_MODELS: ModelSpec[] = [
  { id: "kling-image-3.0",     name: "Kling Image 3.0",     price: 0.2 },
  { id: "kling-image-3.0-omni",name: "Kling Image 3.0 Omni",price: 0.2 },
  { id: "kling-image-o1",      name: "Kling Image O1",      price: 0.2 },
  { id: "kling-image-2.1",     name: "Kling Image 2.1",     price: 0.1 },
  { id: "kling-image-2.1-new", name: "Kling Image 2.1 New", price: 0.2 },
  { id: "kling-image-2.0",     name: "Kling Image 2.0",     price: 0.1 },
  { id: "kling-image-1.5",     name: "Kling Image 1.5",     price: 0.1 },
  { id: "kling-image-1.0",     name: "Kling Image 1.0",     price: 0.025 },
];

const VIDEO_MODELS: ModelSpec[] = [
  { id: "kling-3.0-turbo",     name: "Kling 3.0 Turbo",    price: 0.8, video: true },
  { id: "kling-3.0",           name: "Kling 3.0",          price: 0.6, video: true },
  { id: "kling-3.0-omni",      name: "Kling 3.0 Omni",     price: 0.6, video: true },
  { id: "kling-o1",            name: "Kling O1",           price: 0.6, video: true },
  { id: "kling-2.6",           name: "Kling 2.6",          price: 0.3, video: true },
  { id: "kling-2.5-turbo",     name: "Kling 2.5 Turbo",    price: 0.3, video: true },
  { id: "kling-2.1",           name: "Kling 2.1",          price: 0.4, video: true },
  { id: "kling-2.1-master",    name: "Kling 2.1 Master",   price: 2.0, video: true },
  { id: "kling-2.0-master",    name: "Kling 2.0 Master",   price: 2.0, video: true },
  { id: "kling-1.6",           name: "Kling 1.6",          price: 0.4, video: true },
  { id: "kling-1.5",           name: "Kling 1.5",          price: 0.4, video: true },
  { id: "kling-1.0",           name: "Kling 1.0",          price: 0.2, video: true },
];

async function main() {
  console.log("Fetching Kling models with CNY pricing...");
  let written = 0;

  for (const spec of [...IMAGE_MODELS, ...VIDEO_MODELS]) {
    const isVideo = spec.video === true;

    const entry: ModelEntry = {
      id: spec.id,
      name: spec.name,
      created_by: "kling",
      family: inferFamily(spec.id) ?? "kling",
      model_type: isVideo ? "video" as const : "image" as const,
      pricing: { input: spec.price },
      capabilities: { streaming: true },
      modalities: { input: ["text", "image"], output: isVideo ? ["video"] : ["image"] },
    };

    written += upsertWithSnapshot("kling", entry) ? 1 : 0;
  }

  console.log(`Wrote ${written} models`);
  runGenerate();
}

main().catch((err) => { console.error(err); process.exit(1); });
