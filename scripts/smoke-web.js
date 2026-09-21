import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(
      process.env.WEB_URL || "http://localhost:3000",
    );
    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Jogue na TV.Responda pelo celular.",
    );
    await expect(
      page.getByRole("button", { name: "Criar partida" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Entrar na sala" }),
    ).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText("Servidor conectado", {
      timeout: 15000,
    });
    const input = page.getByLabel("Código da sala");
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    await input.fill("ABC123");
    expect(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/web-${viewport.width}.png`,
      fullPage: true,
    });
    // Bloqueio apenas no navegador: serviço real continua em execução.
    await context.route("**/socket.io/**", (route) => route.abort());
    await page.reload();
    await expect(page.getByRole("status")).toHaveText("Servidor indisponível", {
      timeout: 15000,
    });
    await context.unroute("**/socket.io/**");
    await expect(page.getByRole("status")).toHaveText("Servidor conectado", {
      timeout: 20000,
    });
    console.info(
      JSON.stringify({
        viewport,
        http: 200,
        connected: true,
        unavailable: true,
        reconnected: true,
        keyboard: true,
        overflow: false,
      }),
    );
    await context.close();
  }
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
