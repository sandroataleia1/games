/* global document, window, getComputedStyle */
import { chromium } from "@playwright/test";

const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch();
const results = [];
for (const width of [320, 390, 768, 1440]) {
  const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  for (const path of ["/", "/jogos"]) {
    await page.goto(base + path);
    const card = page.locator("article[data-art]").first();
    await card.waitFor();
    const info = await page.evaluate(() => {
      const article = document.querySelector("article[data-art]");
      const link = article.querySelector("a[aria-label]");
      const a = article.getBoundingClientRect();
      const l = link.getBoundingClientRect();
      const tags = article.querySelector("ul[aria-label=Categorias]");
      const badge = article.querySelector("span[data-status]");
      const overlap = tags && badge ? !(badge.getBoundingClientRect().bottom <= tags.getBoundingClientRect().top || tags.getBoundingClientRect().bottom <= badge.getBoundingClientRect().top) : false;
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        linkCoversCard: Math.abs(l.width - a.width) < 2 && Math.abs(l.height - a.height) < 2,
        overlap,
        liveCounter: /jogando agora/i.test(article.textContent),
      };
    });
    await page.keyboard.press("Tab");
    const focusable = await page.evaluate(() => { const link = document.querySelector("article[data-art] a[aria-label]"); link.focus(); const s = getComputedStyle(link); return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0; });
    results.push({ width, path, ...info, focusRing: focusable });
  }
  await page.close();
}
console.log(JSON.stringify(results));
const bad = results.filter((r) => r.overflow || !r.linkCoversCard || r.overlap || r.liveCounter || !r.focusRing);
if (bad.length) { console.error("PROBLEMS", JSON.stringify(bad)); process.exitCode = 1; }
await browser.close();
