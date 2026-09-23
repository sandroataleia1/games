import { chromium } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, executablePath });
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
const page = await ctx.newPage();

try {
  await page.goto(base + "/");
  await page.locator('[aria-roledescription="carousel"]').waitFor();
  await page.getByRole("heading", { name: "MultyGames", level: 2 }).waitFor();
  // Wait past one full autoplay interval; the slide must NOT have advanced.
  await page.waitForTimeout(7500);
  await page.getByRole("heading", { name: "MultyGames", level: 2 }).waitFor();
  console.log(JSON.stringify({ ok: true, message: "no autoplay advance under prefers-reduced-motion" }));
} finally {
  await ctx.close();
  await browser.close();
}
