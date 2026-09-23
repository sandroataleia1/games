/* global document, window */
import { chromium } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, executablePath });
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const stamp = Date.now();

async function overflowCheck(page, path) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error(`horizontal overflow at ${page.viewportSize().width}px on ${path}`);
}

async function pickTheme(page, quizTitle) {
  const value = await page.locator("select#theme option", { hasText: quizTitle }).getAttribute("value");
  await page.getByLabel("Tema da sala").selectOption(value);
}

const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const hostPage = await hostCtx.newPage();
const hostEmail = `host-rooms-${stamp}@example.com`;
const hostPassword = "SenhaHostRooms123";

const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const guestPage = await guestCtx.newPage();
const guestEmail = `guest-rooms-${stamp}@example.com`;
const guestPassword = "SenhaGuestRooms123";

try {
  // Visitor sees the persistent-rooms pitch, no room catalog leaks without an account.
  await hostPage.goto(base + "/jogos/quiz");
  await hostPage.getByText("As salas já existem prontas para jogar", { exact: false }).waitFor();
  const leakedRooms = await hostPage.locator("article").count();
  if (leakedRooms !== 0) throw new Error("room catalog visible to a visitor");

  // Register the host account, land back on /jogos/quiz, see the fixed room catalog.
  await hostPage.getByRole("link", { name: "Criar conta" }).click();
  await hostPage.getByLabel("Nome").fill("Anfitriã Salas");
  await hostPage.getByLabel("E-mail").fill(hostEmail);
  await hostPage.getByLabel("Senha", { exact: true }).fill(hostPassword);
  await hostPage.getByLabel("Confirmar senha").fill(hostPassword);
  await hostPage.getByRole("button", { name: "Criar conta" }).click();
  await hostPage.waitForURL("**/jogos/quiz");
  await hostPage.getByRole("heading", { name: "Sala 1", exact: true }).waitFor();
  const roomCards = await hostPage.locator("article").count();
  if (roomCards < 10) throw new Error(`expected the fixed room pool, found only ${roomCards} cards`);
  await hostPage.getByText("Aberta", { exact: true }).first().waitFor();
  await hostPage.getByText(/jogador(es)?$/).first().waitFor();

  // Publish a quiz to use as the room's theme.
  await hostPage.goto(base + "/painel");
  await hostPage.getByRole("button", { name: "Criar quiz" }).click();
  await hostPage.waitForURL("**/painel/quizzes/*");
  const quizTitle = `Quiz Salas ${stamp}`;
  await hostPage.getByLabel("Título").fill(quizTitle);
  await hostPage.getByLabel("Descrição").fill("Quiz de verificação das salas persistentes.");
  await hostPage.getByRole("button", { name: "Salvar dados" }).click();
  await hostPage.getByRole("status").filter({ hasText: "Alterações salvas" }).waitFor();
  await hostPage.getByLabel("Enunciado").fill("Pergunta única");
  await hostPage.getByLabel("Duração").fill("6");
  await hostPage.getByRole("textbox", { name: "Alternativa 1" }).fill("Certa");
  await hostPage.getByRole("textbox", { name: "Alternativa 2" }).fill("Errada");
  await hostPage.getByRole("button", { name: "Adicionar pergunta" }).click();
  await hostPage.getByRole("status").filter({ hasText: "Alterações salvas" }).waitFor();
  await hostPage.getByRole("button", { name: "Publicar" }).click();
  await hostPage.getByText("PUBLISHED", { exact: false }).waitFor();

  // Enter room 1, pick the theme, and confirm the room number/status/player-count card updates live.
  await hostPage.goto(base + "/jogos/quiz");
  await hostPage.getByRole("link", { name: "Entrar" }).first().click();
  await hostPage.waitForURL("**/salas/1");
  await hostPage.getByRole("heading", { name: "1", exact: true }).waitFor();
  await pickTheme(hostPage, quizTitle);
  await hostPage.getByText("Anfitriã Salas").waitFor();

  // No owner: anyone present can start. Solo match with a single question finishes immediately.
  await hostPage.getByRole("button", { name: "Iniciar partida" }).click();
  await hostPage.getByText("Pergunta única").waitFor();

  // Clicking an option only selects it; answering requires an explicit confirm.
  await hostPage.getByRole("button", { name: "Certa" }).click();
  await hostPage.getByText("Toque em confirmar", { exact: false }).waitFor();
  const answerLockedIn = await hostPage.getByText("Resposta enviada. Aguarde o resultado.").count();
  if (answerLockedIn !== 0) throw new Error("answer submitted before confirmation");
  await hostPage.getByRole("button", { name: "Confirmar resposta" }).click();
  await hostPage.getByText(/Você acertou|Quase lá/).waitFor({ timeout: 10000 });
  await hostPage.getByRole("button", { name: "Avançar" }).click();
  await hostPage.getByText("Anfitriã Salas venceu!", { exact: false }).waitFor();
  await hostPage.getByRole("button", { name: "Voltar à sala" }).waitFor();

  // Leaving after FINISHED must not crash, and the room card must show OPEN again.
  await hostPage.getByRole("button", { name: "Sair da sala" }).click();
  await hostPage.waitForURL("**/jogos/quiz");
  await hostPage.getByRole("heading", { name: "Sala 1", exact: true }).waitFor();

  // Leaving mid-match while playing solo must finish the match, not leave the room stuck PLAYING.
  // Room 1 still has its theme from before (reopening a room keeps the theme).
  await hostPage.getByRole("link", { name: "Entrar" }).first().click();
  await hostPage.waitForURL("**/salas/1");
  await hostPage.getByRole("button", { name: "Iniciar partida" }).click();
  await hostPage.getByText("Pergunta única").waitFor();
  await hostPage.getByRole("button", { name: "Sair da sala" }).click();
  await hostPage.waitForURL("**/jogos/quiz");
  await hostPage.getByText("Aberta", { exact: true }).first().waitFor();

  // Multiplayer: a second real account enters the same fixed room, no ownership required.
  await guestPage.goto(base + "/cadastro");
  await guestPage.getByLabel("Nome").fill("Convidada Salas");
  await guestPage.getByLabel("E-mail").fill(guestEmail);
  await guestPage.getByLabel("Senha", { exact: true }).fill(guestPassword);
  await guestPage.getByLabel("Confirmar senha").fill(guestPassword);
  await guestPage.getByRole("button", { name: "Criar conta" }).click();
  await guestPage.waitForURL("**/jogos/quiz");
  await guestPage.goto(base + "/salas/1");
  await guestPage.getByRole("heading", { name: "1", exact: true }).waitFor();
  await guestPage.getByText("Convidada Salas").waitFor();

  await hostPage.goto(base + "/salas/1");
  await hostPage.getByText("Convidada Salas").waitFor();
  await pickTheme(hostPage, quizTitle);
  await hostPage.getByRole("button", { name: "Iniciar partida" }).click();
  await guestPage.getByText("Pergunta única").waitFor({ timeout: 10000 });
  await guestPage.getByRole("button", { name: "Errada" }).click();
  await guestPage.getByRole("button", { name: "Confirmar resposta" }).click();
  await guestPage.getByText(/Você acertou|Quase lá/).waitFor({ timeout: 10000 });
  await guestPage.getByRole("button", { name: "Avançar" }).click();
  const finalRanking = await guestPage.locator("ol").innerText();
  if (!finalRanking.includes("Anfitriã Salas") || !finalRanking.includes("Convidada Salas")) throw new Error("final ranking missing a participant");
  await guestPage.getByRole("button", { name: "Sair da sala" }).click();
  await hostPage.getByRole("button", { name: "Sair da sala" }).click();

  // Responsividade: sem overflow horizontal nas páginas novas.
  const pagesToCheck = ["/jogos/quiz", "/salas/1"];
  for (const width of [320, 390, 768, 1440]) {
    await hostPage.setViewportSize({ width, height: 900 });
    for (const path of pagesToCheck) {
      await hostPage.goto(base + path);
      await overflowCheck(hostPage, path);
    }
  }

  console.log(JSON.stringify({ ok: true, hostEmail, guestEmail, quizTitle }));
} catch (error) {
  console.error("FAILURE at", hostPage.url());
  console.error(await hostPage.locator("body").innerText().catch(() => "<no body>"));
  throw error;
} finally {
  await hostCtx.close();
  await guestCtx.close();
  await browser.close();
}
