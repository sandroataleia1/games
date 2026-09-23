import { chromium } from "@playwright/test";

// REAL-BROWSER reconnection of a match in progress (PLATFORM-07C): two accounts play a
// multiplayer Quiz; each reloads the page during a question and during a result, and
// the match resumes with the same round, the same participation and no duplicate
// connection loop. Needs the web (3000) and realtime (3001) servers running.
const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const room = Number(process.env.SMOKE_ROOM || 23);
const stamp = Date.now();
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const hostPage = await hostCtx.newPage();
const guestPage = await guestCtx.newPage();
const accounts = { host: { email: `host-rooms-reconnect-${stamp}@example.com`, name: "Anfitria Reconecta", password: "SenhaReconecta123" }, guest: { email: `guest-rooms-reconnect-${stamp}@example.com`, name: "Convidada Reconecta", password: "SenhaReconecta123" } };
const errors = [];
const sockets = { host: 0, guest: 0 };
for (const [label, page] of [["host", hostPage], ["guest", guestPage]]) {
  page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" && !/status of 401/.test(message.text())) errors.push(`${label}: ${message.text()}`); });
  // Only the realtime (Socket.IO) connections count; the Next dev server opens its own HMR websocket.
  page.on("websocket", (socket) => { if (/socket\.io/.test(socket.url())) sockets[label] += 1; });
}
const step = (message) => console.error(`- ${message}`);

async function signUp(page, { name, email, password }) {
  await page.goto(`${base}/cadastro`);
  await page.getByLabel("Nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.waitForURL("**/jogos/quiz");
}
async function answer(page, option) {
  await page.getByRole("button", { name: option, exact: true }).click();
  await page.getByRole("button", { name: "Confirmar resposta" }).click();
}
async function reloadAndExpect(page, expected, label) {
  const before = sockets[label];
  await page.reload();
  await expected.waitFor({ timeout: 10000 });
  // Reconnecting opens a fresh socket, not a loop of them.
  await page.waitForTimeout(1500);
  if (sockets[label] - before > 2) throw new Error(`${label}: ${sockets[label] - before} websockets after one reload (connection loop?)`);
  if (await page.getByText("Conectando", { exact: false }).count()) throw new Error(`${label}: stuck on "Conectando" after reload`);
}

try {
  step("accounts and a quiz with two questions");
  await signUp(hostPage, accounts.host);
  await signUp(guestPage, accounts.guest);
  await hostPage.goto(`${base}/painel`);
  await hostPage.getByRole("button", { name: "Criar quiz" }).click();
  await hostPage.waitForURL("**/painel/quizzes/*");
  const quizTitle = `Quiz Reconexao ${stamp}`;
  await hostPage.getByLabel("Título").fill(quizTitle);
  await hostPage.getByLabel("Descrição").fill("Reconexão real no navegador.");
  await hostPage.getByRole("button", { name: "Salvar dados" }).click();
  await hostPage.getByRole("status").filter({ hasText: "Alterações salvas" }).waitFor();
  for (const [prompt, right, wrong] of [["Pergunta um", "Certa um", "Errada um"], ["Pergunta dois", "Certa dois", "Errada dois"]]) {
    await hostPage.getByLabel("Enunciado").fill(prompt);
    await hostPage.getByLabel("Duração").fill("60");
    await hostPage.getByRole("textbox", { name: "Alternativa 1" }).fill(right);
    await hostPage.getByRole("textbox", { name: "Alternativa 2" }).fill(wrong);
    await hostPage.getByRole("button", { name: "Adicionar pergunta" }).click();
    await hostPage.getByRole("status").filter({ hasText: "Alterações salvas" }).waitFor();
  }
  await hostPage.getByRole("button", { name: "Publicar" }).click();
  await hostPage.getByText("PUBLISHED", { exact: false }).waitFor();

  step("both enter the room; the host picks the theme and starts");
  await guestPage.goto(`${base}/salas/${room}`);
  await guestPage.getByText(accounts.guest.name).waitFor();
  await hostPage.goto(`${base}/salas/${room}`);
  await hostPage.getByText(accounts.guest.name).waitFor();
  const value = await hostPage.locator("select#theme option", { hasText: quizTitle }).getAttribute("value");
  await hostPage.getByLabel("Tema da sala").selectOption(value);
  await hostPage.getByRole("button", { name: "Iniciar partida" }).click();
  await hostPage.getByText("Pergunta um").waitFor({ timeout: 10000 });
  await guestPage.getByText("Pergunta um").waitFor({ timeout: 10000 });

  step("guest reloads DURING the question and is still in round 1");
  await reloadAndExpect(guestPage, guestPage.getByText("Pergunta um"), "guest");
  step("host reloads DURING the question");
  await reloadAndExpect(hostPage, hostPage.getByText("Pergunta um"), "host");

  step("both answer after reconnecting; the result appears as soon as everyone answered");
  await answer(guestPage, "Errada um");
  await answer(hostPage, "Certa um");
  await hostPage.getByText(/Você acertou|Quase lá/).waitFor({ timeout: 10000 });
  await guestPage.getByText(/Você acertou|Quase lá/).waitFor({ timeout: 10000 });

  step("guest reloads DURING the result");
  await reloadAndExpect(guestPage, guestPage.getByText(/Você acertou|Quase lá/), "guest");

  step("advance to round 2; guest reloads and resumes round 2");
  await hostPage.getByRole("button", { name: "Avançar" }).click();
  await hostPage.getByText("Pergunta dois").waitFor({ timeout: 10000 });
  await guestPage.getByText("Pergunta dois").waitFor({ timeout: 10000 });
  await reloadAndExpect(guestPage, guestPage.getByText("Pergunta dois"), "guest");
  await answer(guestPage, "Certa dois");
  await answer(hostPage, "Certa dois");
  await hostPage.getByText(/Você acertou|Quase lá/).waitFor({ timeout: 10000 });
  await hostPage.getByRole("button", { name: "Avançar" }).click();

  step("final ranking has both participants, with the scores kept across reloads");
  await guestPage.locator("ol").waitFor({ timeout: 10000 });
  const ranking = await guestPage.locator("ol").innerText();
  if (!ranking.includes(accounts.host.name) || !ranking.includes(accounts.guest.name)) throw new Error("final ranking missing a participant");

  step("the pages never carried the answer key or internal data");
  for (const page of [hostPage, guestPage]) {
    const html = await page.content();
    if (/isCorrect|quizSnapshot|hostTokenHash|reconnectTokenHash|currentSessionId/.test(html)) throw new Error("internal data present in the page");
  }
  await guestPage.getByRole("button", { name: "Sair da sala" }).click();
  await hostPage.getByRole("button", { name: "Sair da sala" }).click();
  if (errors.length) throw new Error(`runtime errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, room, reloads: 4, websockets: sockets, quizTitle }));
} catch (error) {
  console.error("FAILURE", await hostPage.url(), "|", await guestPage.url());
  console.error("host:", (await hostPage.locator("body").innerText().catch(() => "")).slice(0, 500));
  console.error("guest:", (await guestPage.locator("body").innerText().catch(() => "")).slice(0, 500));
  throw error;
} finally {
  await hostCtx.close();
  await guestCtx.close();
  await browser.close();
}
