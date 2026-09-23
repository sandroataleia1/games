import { chromium } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, executablePath });
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const requests404 = [];
page.on("response", (response) => {
  if (response.status() === 404) requests404.push(response.url());
});

try {
  await page.goto(base + "/");
  await page.getByText("MultyGames").first().waitFor();
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  console.log("manifest link:", manifestHref);
  const manifest = await page.evaluate(async (href) => (await fetch(href)).json(), manifestHref);
  console.log("manifest:", JSON.stringify(manifest));

  await page.goto(base + "/jogos/quiz");
  await page.getByText("MultyGames", { exact: false }).first().waitFor();
  await page.screenshot({ path: "scripts/.screens/jogos-quiz-header.png" });

  console.log("404s:", JSON.stringify(requests404));
  if (requests404.length) throw new Error("assets returned 404: " + requests404.join(", "));

  console.log(JSON.stringify({ ok: true }));
} finally {
  await ctx.close();
  await browser.close();
}
