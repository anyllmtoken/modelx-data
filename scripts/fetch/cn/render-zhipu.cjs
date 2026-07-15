const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://open.bigmodel.cn/pricing", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);
  const html = await page.content();
  process.stdout.write(html);
  await browser.close();
})();
