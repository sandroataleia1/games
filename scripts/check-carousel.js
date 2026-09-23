import { chromium } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, executablePath });
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

try {
  await page.goto(base + "/");
  const carousel = page.locator('[aria-roledescription="carousel"]');
  await carousel.waitFor();

  // Slide 1 content visible.
  await page.getByRole("heading", { name: "MultyGames", level: 2 }).waitFor();

  // Next button advances to slide 2.
  await page.getByRole("button", { name: "Próxima lâmina" }).click();
  await page.getByRole("heading", { name: "Desafie sua turma" }).waitFor();
  await page.getByRole("link", { name: /Jogar Quiz/ }).waitFor();

  // Next again -> slide 3.
  await page.getByRole("button", { name: "Próxima lâmina" }).click();
  await page.getByRole("heading", { name: "Prefere jogar sozinho?" }).waitFor();

  // Circular: next again wraps back to slide 1.
  await page.getByRole("button", { name: "Próxima lâmina" }).click();
  await page.getByRole("heading", { name: "MultyGames", level: 2 }).waitFor();

  // Prev button goes backward (circular the other way).
  await page.getByRole("button", { name: "Lâmina anterior" }).click();
  await page.getByRole("heading", { name: "Prefere jogar sozinho?" }).waitFor();

  // Indicators: click indicator 2 directly.
  const indicators = page.getByRole("button", { name: /Ir para lâmina/ });
  await indicators.nth(1).click();
  await page.getByRole("heading", { name: "Desafie sua turma" }).waitFor();
  await indicators.nth(1).evaluate((el) => el.getAttribute("aria-current"));

  // Keyboard: focus the carousel region, ArrowRight advances.
  await page.locator('[aria-roledescription="carousel"]').focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("heading", { name: "Prefere jogar sozinho?" }).waitFor();
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("heading", { name: "Desafie sua turma" }).waitFor();

  // Height stays consistent across slides (no layout jump).
  const heights = [];
  for (let i = 0; i < 3; i++) {
    heights.push(await carousel.evaluate((el) => el.getBoundingClientRect().height));
    await page.getByRole("button", { name: "Próxima lâmina" }).click();
    await page.waitForTimeout(150);
  }
  const spread = Math.max(...heights) - Math.min(...heights);
  console.log("heights:", heights, "spread:", spread);
  if (spread > 40) throw new Error("carousel height jumps between slides: " + JSON.stringify(heights));

  console.log(JSON.stringify({ ok: true }));
} finally {
  await ctx.close();
  await browser.close();
}
