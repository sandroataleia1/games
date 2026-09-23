/* global document, window */
import { chromium } from "@playwright/test";

// PLATFORM-07B: visitor journey + category filter, with no runtime errors and no
// internal identifiers leaking into the public pages.
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
// A visitor legitimately gets 401 from /api/auth/me; anything else is a real error.
page.on("console", (message) => { if (message.type() === "error" && !/status of 401/.test(message.text())) errors.push(message.text()); });
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const results = {};
try {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  results.home = await noOverflow();
  await page.goto(`${base}/jogos`, { waitUntil: "networkidle" });
  results.catalog = await noOverflow();
  await page.goto(`${base}/jogos?categoria=trivia`, { waitUntil: "networkidle" });
  results.categoryFilter = (await page.getByRole("link", { name: /Abrir detalhes de Quiz/ }).count()) === 1;
  await page.goto(`${base}/jogos/quiz`, { waitUntil: "networkidle" });
  results.quizPage = await noOverflow();
  const html = await page.content();
  results.noInternalData = !/gameKey|hostTokenHash|reconnectTokenHash|quizSnapshot|currentSessionId/.test(html);
  // A visitor trying to enter a room is sent to authentication and back.
  await page.goto(`${base}/salas/3`, { waitUntil: "networkidle" });
  results.visitorRedirectedToLogin = /\/login\?next=%2Fsalas%2F3/.test(page.url());
  results.noRuntimeErrors = errors.length === 0;
  console.log(JSON.stringify({ results, errors }));
  if (!results.home || !results.catalog || !results.categoryFilter || !results.quizPage || !results.noInternalData || !results.visitorRedirectedToLogin || errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
