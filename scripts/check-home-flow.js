import { chromium } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, executablePath });
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const stamp = Date.now();

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

try {
  // Visitante: logo, catálogo, Quiz, botão principal, Entrar, Cadastrar.
  await page.goto(base + "/");
  await page.getByText("QuizArena").waitFor();
  await page.getByRole("heading", { name: "Qual jogo vamos jogar hoje?" }).waitFor();
  await page.getByRole("heading", { name: "Quiz", exact: true }).waitFor();
  await page.getByRole("link", { name: "Entrar", exact: true }).waitFor();
  await page.getByRole("link", { name: "Criar conta" }).first().waitFor();
  await page.getByRole("link", { name: /Ver detalhes/ }).click();
  await page.waitForURL("**/jogos/quiz");
  await page.getByText("necessário ter uma conta", { exact: false }).waitFor();

  // Login e retorno à home.
  await page.goto(base + "/");
  const email = `home-check-${stamp}@example.com`;
  await page.getByRole("link", { name: "Criar conta" }).first().click();
  await page.getByLabel("Nome").fill("Checagem Home");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("SenhaChecagem123");
  await page.getByLabel("Confirmar senha").fill("SenhaChecagem123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.waitForURL("**/jogos/quiz");

  // Autenticado: home reconhece a sessão, mostra "Jogar agora", painel e sair.
  await page.goto(base + "/");
  await page.getByText("Olá, Checagem Home").waitFor();
  await page.getByRole("link", { name: "Meu painel" }).waitFor();
  await page.getByRole("link", { name: "Jogar agora" }).waitFor();
  await page.getByRole("button", { name: "Sair" }).click();
  await page.getByRole("link", { name: "Entrar", exact: true }).waitFor();

  console.log(JSON.stringify({ ok: true, email }));
} catch (error) {
  console.error("FAILURE at", page.url());
  console.error(await page.locator("body").innerText().catch(() => "<no body>"));
  throw error;
} finally {
  await ctx.close();
  await browser.close();
}
