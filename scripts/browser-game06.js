/* global document, window */
import { chromium } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, executablePath });
const base = "http://localhost:3000";
const stamp = Date.now();

async function overflowCheck(page, path) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error(`horizontal overflow at ${page.viewportSize().width}px on ${path}`);
}

const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const hostPage = await hostCtx.newPage();
const hostEmail = `host-portal-${stamp}@example.com`;
const hostPassword = "SenhaHostPortal123";

const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const guestPage = await guestCtx.newPage();
const guestEmail = `guest-portal-${stamp}@example.com`;
const guestPassword = "SenhaGuestPortal123";

try {
  // 1-2. Visitante abre "/", vê o jogo Quiz, sem sessão.
  await hostPage.goto(base + "/");
  await hostPage.getByRole("link", { name: "Entrar" }).waitFor();
  await hostPage.getByRole("link", { name: "Cadastrar" }).waitFor();
  await hostPage.getByRole("link", { name: "Ver detalhes" }).click();
  await hostPage.waitForURL("**/jogos/quiz");

  // 3-6. Detalhes do jogo Quiz sem login: sem quizzes/salas, com CTA de conta.
  await hostPage.getByRole("heading", { name: "Quiz" }).waitFor();
  const leakedQuiz = await hostPage.getByRole("heading", { name: "Quizzes publicados" }).count();
  if (leakedQuiz !== 0) throw new Error("quiz catalog visible to a visitor");
  await hostPage.getByRole("link", { name: "Criar conta" }).click();
  await hostPage.waitForURL(/\/cadastro\?next=/);

  // 7-8. Cria conta e retorna ao destino pretendido (retorno seguro pós-login).
  await hostPage.getByLabel("Nome").fill("Anfitriã Portal");
  await hostPage.getByLabel("E-mail").fill(hostEmail);
  await hostPage.getByLabel("Senha", { exact: true }).fill(hostPassword);
  await hostPage.getByLabel("Confirmar senha").fill(hostPassword);
  await hostPage.getByRole("button", { name: "Criar conta" }).click();
  await hostPage.waitForURL("**/jogos/quiz");
  await hostPage.getByRole("heading", { name: "Quizzes publicados" }).waitFor();

  // Autoria: cria e publica um quiz próprio no painel (separado da experiência de jogar).
  await hostPage.goto(base + "/painel");
  await hostPage.getByRole("button", { name: "Criar quiz" }).click();
  await hostPage.waitForURL("**/painel/quizzes/*");
  const quizTitle = `Quiz Portal ${stamp}`;
  await hostPage.getByLabel("Título").fill(quizTitle);
  await hostPage.getByLabel("Descrição").fill("Quiz de verificação do portal de jogos.");
  await hostPage.getByRole("button", { name: "Salvar dados" }).click();
  await hostPage.getByRole("status").filter({ hasText: "Alterações salvas" }).waitFor();
  for (const [prompt, right, wrong] of [["Pergunta um", "Certa um", "Errada um"], ["Pergunta dois", "Certa dois", "Errada dois"]]) {
    await hostPage.getByLabel("Enunciado").fill(prompt);
    await hostPage.getByLabel("Duração").fill("6");
    await hostPage.getByRole("textbox", { name: "Alternativa 1" }).fill(right);
    await hostPage.getByRole("textbox", { name: "Alternativa 2" }).fill(wrong);
    await hostPage.getByRole("button", { name: "Adicionar pergunta" }).click();
    await hostPage.getByRole("status").filter({ hasText: "Alterações salvas" }).waitFor();
  }
  await hostPage.getByRole("button", { name: "Publicar" }).click();
  await hostPage.getByText("PUBLISHED", { exact: false }).waitFor();
  const quizUrl = hostPage.url();
  const quizId = quizUrl.split("/").pop();

  // 9-13. Catálogo autenticado: vê o próprio quiz, abre a página de salas, cria sala pública.
  await hostPage.goto(base + "/jogos/quiz");
  await hostPage.getByText(quizTitle).waitFor();
  await hostPage.getByRole("link", { name: "Ver salas" }).first().click();
  await hostPage.waitForURL(`**/jogos/quiz/quizzes/${quizId}`);
  await hostPage.getByText("Nenhuma sala pública aberta").waitFor();
  await hostPage.getByLabel("Pública").check();
  await hostPage.getByLabel("Organizar e jogar").check();
  await hostPage.getByRole("button", { name: "Criar sala" }).click();
  await hostPage.waitForURL("**/host/*");
  const soloRoomCode = hostPage.url().split("/").pop();

  // 14-17. Organiza e joga sozinho: inicia com um participante (o próprio host).
  await hostPage.getByText("1 / 20").waitFor();
  await hostPage.getByRole("button", { name: "Iniciar partida" }).click();
  await hostPage.getByRole("button", { name: /Certa|Errada/ }).first().click();
  await hostPage.getByText(/Você acertou|Resposta revelada/).waitFor({ timeout: 10000 });
  await hostPage.getByRole("button", { name: "Avançar" }).click();
  await hostPage.getByRole("button", { name: /Certa|Errada/ }).first().click();
  await hostPage.getByText(/Você acertou|Resposta revelada/).waitFor({ timeout: 10000 });
  await hostPage.getByRole("button", { name: "Avançar" }).click();
  await hostPage.getByText("Ranking final").waitFor();
  const soloRankingText = await hostPage.locator("ol").innerText();
  if (!soloRankingText.includes("Anfitriã Portal")) throw new Error("solo ranking missing the host");

  // 18. Cria segunda sala pública, desta vez apenas organizando (para multiplayer real).
  await hostPage.goto(base + `/jogos/quiz/quizzes/${quizId}`);
  await hostPage.getByLabel("Pública").check();
  await hostPage.getByLabel("Somente organizar").check();
  await hostPage.getByRole("button", { name: "Criar sala" }).click();
  await hostPage.waitForURL("**/host/*");
  const multiRoomCode = hostPage.url().split("/").pop();
  await hostPage.getByText("0 / 20").waitFor();

  // Sala privada: cria e confirma que não aparece na listagem pública do quiz.
  await hostPage.goto(base + `/jogos/quiz/quizzes/${quizId}`);
  await hostPage.getByLabel("Privada").check();
  await hostPage.getByLabel("Somente organizar").check();
  await hostPage.getByRole("button", { name: "Criar sala" }).click();
  await hostPage.waitForURL("**/host/*");
  const privateRoomCode = hostPage.url().split("/").pop();

  // 19-20. Outro usuário autenticado entra na sala pública multiplayer.
  await guestPage.goto(base + "/cadastro");
  await guestPage.getByLabel("Nome").fill("Convidada Portal");
  await guestPage.getByLabel("E-mail").fill(guestEmail);
  await guestPage.getByLabel("Senha", { exact: true }).fill(guestPassword);
  await guestPage.getByLabel("Confirmar senha").fill(guestPassword);
  await guestPage.getByRole("button", { name: "Criar conta" }).click();
  await guestPage.waitForURL("**/painel");
  await guestPage.goto(base + `/jogos/quiz/quizzes/${quizId}`);
  await guestPage.getByText(multiRoomCode).waitFor();
  const privateVisible = await guestPage.getByText(privateRoomCode).count();
  if (privateVisible !== 0) throw new Error("private room leaked into the public catalog");
  await guestPage.getByRole("link", { name: "Entrar" }).first().click();
  await guestPage.waitForURL(`**/salas/${multiRoomCode}`);
  await guestPage.getByText("Aguardando o organizador iniciar").waitFor();

  // 21-22. Acesso por código funciona para a sala privada (autenticado).
  await guestCtx.newPage().then(async (codePage) => {
    await codePage.goto(base + `/jogos/quiz/quizzes/${quizId}`);
    await codePage.getByLabel("Código da sala").fill(privateRoomCode);
    await codePage.getByRole("button", { name: "Entrar" }).last().click();
    await codePage.waitForURL(`**/salas/${privateRoomCode}`);
    await codePage.close();
  });

  // Partida multiplayer: host inicia, convidada responde, ranking final contém só a convidada.
  await hostPage.goto(base + `/host/${multiRoomCode}`);
  await hostPage.getByText("1 / 20").waitFor();
  await hostPage.getByRole("button", { name: "Iniciar partida" }).click();
  await guestPage.getByText(/Rodada 1 de/).waitFor({ timeout: 10000 });
  await guestPage.getByRole("button", { name: /Certa|Errada/ }).first().click();
  await guestPage.getByText(/Você acertou|Quase lá/).waitFor({ timeout: 10000 });
  await hostPage.getByRole("button", { name: "Avançar" }).click();
  await guestPage.getByText(/Rodada 2 de/).waitFor({ timeout: 10000 });
  await guestPage.getByRole("button", { name: /Certa|Errada/ }).first().click();
  await guestPage.getByText(/Você acertou|Quase lá/).waitFor({ timeout: 10000 });
  await hostPage.getByRole("button", { name: "Avançar" }).click();
  await hostPage.getByText("Ranking final").waitFor();
  const multiRankingText = await hostPage.locator("ol").innerText();
  if (!multiRankingText.includes("Convidada Portal")) throw new Error("multiplayer ranking missing the guest");
  if (multiRankingText.includes("Anfitriã Portal")) throw new Error("organize-only host leaked into the ranking");

  // Responsividade: sem overflow horizontal nas páginas novas, em quatro larguras.
  const pagesToCheck = ["/", "/jogos/quiz", "/login", "/cadastro", `/jogos/quiz/quizzes/${quizId}`, `/salas/${multiRoomCode}`];
  for (const width of [320, 390, 768, 1440]) {
    await hostPage.setViewportSize({ width, height: 900 });
    for (const path of pagesToCheck) {
      await hostPage.goto(base + path);
      await overflowCheck(hostPage, path);
    }
  }

  console.log(JSON.stringify({ ok: true, hostEmail, guestEmail, quizId, soloRoomCode, multiRoomCode, privateRoomCode, viewports: [320, 390, 768, 1440] }));
} catch (error) {
  console.error("FAILURE at", hostPage.url());
  console.error(await hostPage.locator("body").innerText().catch(() => "<no body>"));
  throw error;
} finally {
  await hostCtx.close();
  await guestCtx.close();
  await browser.close();
}
