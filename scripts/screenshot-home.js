/* global document, window */
import { chromium } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, executablePath });
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const viewports = [
  { width: 320, height: 760 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(base + "/");
  await page.getByRole("heading", { name: "Qual jogo vamos jogar hoje?" }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(`${viewport.width}px overflow=${overflow}`);
  await page.screenshot({ path: `scripts/.screens/home-${viewport.width}.png`, fullPage: true });
  await context.close();
}
await browser.close();
