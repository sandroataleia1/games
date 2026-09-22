import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDatabase } from "@quizarena/database";
import { createClient } from "../../../packages/database/src/client.js";
import { isolatedTestUrl } from "../../../packages/database/tooling/environment.js";
import { createRealtimeServer } from "../src/server.js";

const databaseUrl = isolatedTestUrl();
const database = createDatabase({ databaseUrl });
const cleanup = createClient(databaseUrl);
const email = `http-${randomUUID()}@example.com`;
let server, base, cookie, ownerId;
beforeAll(async () => { server = createRealtimeServer({ healthChecker: async () => ({ status: "ok" }), database, webOrigin: "http://localhost:3000" }); await new Promise((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.httpServer.address().port}`; });
afterAll(async () => { await server.close(); if (ownerId) { await cleanup.organizerSession.deleteMany({ where: { ownerId } }); await cleanup.organizer.delete({ where: { id: ownerId } }); } await Promise.all([database.close(), cleanup.$disconnect()]); });
const request = (path, options = {}) => fetch(base + path, { ...options, headers: { Origin: "http://localhost:3000", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });

test("register sets hardened cookie and session supports me, origin protection and logout", async () => {
  const registered = await request("/api/auth/register", { method: "POST", body: JSON.stringify({ name: "Pessoa HTTP", email, password: "SenhaSegura123" }) });
  expect(registered.status).toBe(201);
  const setCookie = registered.headers.get("set-cookie");
  expect(setCookie).toContain("quizarena_session="); expect(setCookie).toContain("HttpOnly"); expect(setCookie).toContain("SameSite=Lax"); expect(setCookie).toContain("Expires=");
  cookie = setCookie.split(";")[0];
  const body = await registered.json(); ownerId = body.data.user.id;
  expect(body.data.user).not.toHaveProperty("passwordHash");
  expect((await request("/api/auth/me")).status).toBe(200);
  const csrf = await fetch(base + "/api/quizzes", { method: "POST", headers: { Origin: "https://evil.example", Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ title: "Ataque" }) });
  expect(csrf.status).toBe(400); expect(JSON.stringify(await csrf.json())).not.toContain("stack");
  expect((await request("/api/auth/logout", { method: "POST", body: "{}" })).status).toBe(200);
  expect((await request("/api/auth/me")).status).toBe(401);
});
