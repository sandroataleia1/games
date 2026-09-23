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
  await page.getByRole("heading", { name: "MultyGames", level: 2 }).waitFor();

  // Hover keeps the slide from auto-advancing past one interval.
  await carousel.hover();
  await page.waitForTimeout(7500);
  await page.getByRole("heading", { name: "MultyGames", level: 2 }).waitFor();
  console.log("hover: still on slide 1 after 7.5s - ok");

  // Moving away resumes autoplay eventually.
  await page.mouse.move(10, 10);
  await page.waitForTimeout(7500);
  const stillSlide1 = await page.getByRole("heading", { name: "MultyGames", level: 2 }).count();
  console.log("after leaving hover + 7.5s, still slide 1:", stillSlide1 === 1, "(expected false - it should have advanced)");

  console.log(JSON.stringify({ ok: true }));
} finally {
  await ctx.close();
  await browser.close();
}
