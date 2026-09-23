/* global document, window */
import { chromium } from "@playwright/test";

// Quiz authoring lifecycle in the CURRENT interface: sign up, sign out/in, create a
// quiz, refuse publishing an empty one, add questions, reorder, publish, unpublish,
// and check the account pages at four widths. Replaces browser-game05/06, which
// drove the pre-portal UI (host codes, "Criar sala", /host, /play) that no longer exists.
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const stamp = Date.now();
const email = `authoring-rooms-${stamp}@example.com`;
const password = "SenhaAutoria123";
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
// 401 (session probe) and the 422 of the deliberate empty publish are expected; anything else is an error.
page.on("response", (response) => { const status = response.status(); if (status >= 400 && ![401, 422].includes(status)) errors.push(`${status} ${response.request().method()} ${response.url()}`); });

try {
  await page.goto(`${base}/cadastro`);
  await page.getByLabel("Nome").fill("Autoria Browser");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.waitForURL("**/jogos/quiz");

  await page.goto(`${base}/painel`);
  await page.getByRole("button", { name: "Sair" }).click();
  await page.waitForURL("**/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/(painel|jogos)/);

  await page.goto(`${base}/painel`);
  await page.getByRole("button", { name: "Criar quiz" }).click();
  await page.waitForURL("**/painel/quizzes/*");
  await page.getByLabel("Título").fill(`Quiz Autoria ${stamp}`);
  await page.getByLabel("Descrição").fill("Ciclo de autoria automatizado.");
  await page.getByRole("button", { name: "Salvar dados" }).click();
  await page.getByRole("status").filter({ hasText: "Alterações salvas" }).waitFor();

  // An empty quiz cannot be published.
  await page.getByRole("button", { name: "Publicar" }).click();
  await page.getByRole("alert").filter({ hasText: "questions" }).waitFor();

  for (const [prompt, right, wrong] of [["Pergunta um", "Certa um", "Errada um"], ["Pergunta dois", "Certa dois", "Errada dois"]]) {
    await page.getByLabel("Enunciado").fill(prompt);
    await page.getByLabel("Duração").fill("5");
    await page.getByRole("textbox", { name: "Alternativa 1" }).fill(right);
    await page.getByRole("textbox", { name: "Alternativa 2" }).fill(wrong);
    await page.getByRole("button", { name: "Adicionar pergunta" }).click();
    await page.getByRole("status").filter({ hasText: "Alterações salvas" }).waitFor();
  }
  await page.getByRole("button", { name: "Descer pergunta" }).first().click();
  await page.getByRole("button", { name: "Publicar" }).click();
  await page.getByText("PUBLISHED", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Despublicar" }).click();
  await page.getByText("DRAFT", { exact: false }).waitFor();

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/painel", "/jogos", "/jogos/quiz"]) {
      await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`horizontal overflow at ${width}px on ${path}`);
    }
  }
  if (errors.length) throw new Error(`runtime errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, email, viewports: [320, 390, 768, 1440] }));
} finally {
  await browser.close();
}
