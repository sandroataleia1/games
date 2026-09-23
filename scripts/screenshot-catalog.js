/* global document, window */
import { chromium } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, executablePath });
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const viewports = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(base + "/jogos");
  await page.getByRole("heading", { name: "Todos os jogos" }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(`${viewport.width}px overflow=${overflow}`);
  await page.screenshot({ path: `scripts/.screens/catalog-${viewport.width}.png`, fullPage: true });
  await context.close();
}
await browser.close();
