import { chromium } from "@playwright/test";

// Loads a (404) page from each real origin the dev server answers on and asks the realtime service
// (over the browser's real CORS machinery) for /health and a Socket.IO
// polling handshake. `allowed` origins must succeed, the other must be blocked.
const realtime = process.env.REALTIME_URL || "http://localhost:3001";
const cases = [
  { origin: "http://localhost:3000", allowed: true },
  { origin: "http://192.168.1.239:3000", allowed: true },
  { origin: "http://evil.localhost:3000", allowed: false },
];
const browser = await chromium.launch();
let failed = false;
for (const { origin, allowed } of cases) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(origin + "/cors-probe-page", { waitUntil: "commit" });
  const outcome = await page.evaluate(async (url) => {
    const probe = async (path) => { try { const r = await fetch(url + path, { credentials: "include" }); return r.ok; } catch { return false; } };
    return { health: await probe("/health"), socket: await probe("/socket.io/?EIO=4&transport=polling") };
  }, realtime);
  const ok = allowed ? outcome.health && outcome.socket : !outcome.health && !outcome.socket;
  console.log(origin, "expected", allowed ? "allowed" : "blocked", "->", JSON.stringify(outcome), ok ? "OK" : "WRONG");
  if (!ok) failed = true;
  await page.close();
}
await browser.close();
process.exitCode = failed ? 1 : 0;
