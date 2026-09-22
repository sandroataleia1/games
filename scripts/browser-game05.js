/* global document, window */
import { chromium } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, executablePath });
const organizer = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await organizer.newPage();
const email = `browser-${Date.now()}@example.com`;
const password = "SenhaBrowser123";
const base = "http://localhost:3000";
try {
  await page.goto(`${base}/cadastro`);
  await page.getByLabel("Nome").fill("Organizador Browser"); await page.getByLabel("E-mail").fill(email); await page.getByLabel("Senha", { exact: true }).fill(password); await page.getByLabel("Confirmar senha").fill(password); await page.getByRole("button", { name: "Criar conta" }).click(); await page.waitForURL("**/painel");
  await page.getByRole("button", { name: "Sair" }).click(); await page.waitForURL("**/login");
  await page.getByLabel("E-mail").fill(email); await page.getByLabel("Senha").fill(password); await page.getByRole("button", { name: "Entrar", exact: true }).click(); await page.waitForURL("**/painel");
  await page.getByRole("button", { name: "Criar quiz" }).click(); await page.waitForURL("**/painel/quizzes/*");
  await page.getByLabel("Título").fill("Quiz Browser"); await page.getByLabel("Descrição").fill("Fluxo completo automatizado"); await page.getByRole("button", { name: "Salvar dados" }).click();
  await page.getByRole("button", { name: "Publicar" }).click(); await page.getByRole("alert").filter({ hasText: "questions" }).waitFor();
  for (const [prompt, right, wrong] of [["Pergunta um", "Certa um", "Errada um"], ["Pergunta dois", "Certa dois", "Errada dois"]]) { await page.getByLabel("Enunciado").fill(prompt); await page.getByLabel("Duração").fill("5"); await page.getByRole("textbox", { name: "Alternativa 1" }).fill(right); await page.getByRole("textbox", { name: "Alternativa 2" }).fill(wrong); await page.getByRole("button", { name: "Adicionar pergunta" }).click(); await page.getByRole("status").filter({ hasText: "Alterações salvas" }).waitFor(); }
  await page.getByRole("button", { name: "Descer pergunta" }).first().click(); await page.getByRole("button", { name: "Publicar" }).click();
  await page.getByRole("button", { name: "← Painel" }).click(); await page.getByRole("link", { name: "Criar sala" }).click();
  const quizOption = await page.getByLabel("Quiz publicado").locator("option", { hasText: "Quiz Browser" }).getAttribute("value"); await page.getByLabel("Quiz publicado").selectOption(quizOption); await page.getByRole("button", { name: "Criar partida" }).click(); await page.waitForURL("**/host/*");
  const roomCode = page.url().split("/").pop();
  const playerContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); const player = await playerContext.newPage(); await player.goto(`${base}/play/${roomCode}`); await player.getByLabel("Seu nome").fill("Jogador Browser"); await player.getByRole("button", { name: "Entrar no lobby" }).click(); await page.getByText("Jogador Browser").waitFor();
  await page.getByRole("button", { name: "Iniciar partida" }).click();
  for (let round = 1; round <= 2; round += 1) { await player.getByRole("button", { name: /Certa|Errada/ }).first().click(); await player.getByText("Resultado da rodada").waitFor({ timeout: 10000 }); if (round < 2) await page.getByRole("button", { name: "Avançar" }).click(); else await page.getByRole("button", { name: "Avançar" }).click(); }
  await page.getByText("Ranking final").waitFor(); await player.getByText("Ranking final").waitFor();
  await page.goto(`${base}/painel`); await page.getByRole("link", { name: "Editar" }).click(); await page.getByRole("button", { name: "Despublicar" }).click(); await page.getByText("DRAFT", { exact: false }).waitFor();
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); for (const path of ["/login", "/cadastro", "/painel", `/painel/quizzes/${page.url().split("/").pop()}`, "/", `/play/${roomCode}`]) { await page.goto(base + path); const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); if (overflow) throw new Error(`horizontal overflow at ${width}px on ${path}`); } }
  console.log(JSON.stringify({ ok: true, roomCode, email, viewports: [320, 390, 768, 1440], historicalMatch: "FINISHED", unpublished: true }));
  await playerContext.close();
} finally { await organizer.close(); await browser.close(); }
