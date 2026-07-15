/**
 * Render Zhipu pricing page using Playwright.
 * Falls back to Python if Bun Playwright launch fails on Windows.
 */
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function renderZhipuPage(): Promise<string> {
  // Try Bun Playwright first
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      timeout: 30000,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto("https://open.bigmodel.cn/pricing", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(5000);
    const html = await page.content();
    await browser.close();
    return html;
  } catch (err) {
    // Fallback: Node.js Playwright (works on Windows where Bun WebSocket has issues)
    const cjsPath = join(__dirname, "render-zhipu.cjs");
    return execSync(`node "${cjsPath}"`, { encoding: "utf-8", timeout: 60000 });
  }
}
