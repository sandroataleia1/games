import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// Smoke of the CURRENT portal at three widths: home and catalog answer 200, the
// page has its heading and game cards, nothing overflows horizontally, and the
// browser reports no runtime errors. (The pre-portal version of this script drove
// the room-code home page, which no longer exists.) Screenshots go to .local/.
await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
const base = process.env.WEB_URL || "http://localhost:3000";
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
const errors = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" && !/status of 401/.test(message.text())) errors.push(message.text()); });
    for (const path of ["/", "/jogos"]) {
      const response = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
      expect(response.status()).toBe(200);
      await expect(page.getByRole("heading").first()).toBeVisible();
      expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
    }
    await expect(page.getByRole("link", { name: /Abrir detalhes de Quiz/ })).toBeVisible();
    await page.screenshot({ path: `.local/web-${viewport.width}.png`, fullPage: true });
    console.info(JSON.stringify({ viewport, http: 200, overflow: false, catalog: true }));
    await context.close();
  }
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
