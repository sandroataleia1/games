import { config } from "dotenv";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { Server } from "socket.io";
import { EVENTS, systemPingSchema } from "@quizarena/contracts";
import { createDatabase } from "@quizarena/database";
import { createApp } from "./app.js";
import { createDependencyChecks } from "./dependencies.js";
import { createHealthChecker } from "./health.js";
import { createLobbyRuntime } from "./lobby.js";

export function createRealtimeServer({
  healthChecker,
  dependencies,
  lobby = null,
  webOrigin = "http://localhost:3000",
}) {
  const httpServer = http.createServer(createApp({ healthChecker, webOrigin }));
  const io = new Server(httpServer, {
    cors: { origin: webOrigin },
    maxHttpBufferSize: 16 * 1024,
  });
  io.on("connection", (socket) =>
    socket.on(EVENTS.SYSTEM_PING, (payload, acknowledge) => {
      const parsed = systemPingSchema.safeParse(payload);
      const reply = (value) => {
        if (typeof acknowledge === "function") acknowledge(value);
      };
      if (!parsed.success) {
        reply({ error: "invalid_payload" });
        return;
      }
      const response = { ...parsed.data, serverAt: new Date().toISOString() };
      socket.emit(EVENTS.SYSTEM_PONG, response);
      reply(response);
    }),
  );
  let activeLobby = lobby;
  io.on("connection", (socket) => activeLobby?.attach(socket));
  let closing;
  return {
    httpServer,
    io,
    setLobby(runtime) { activeLobby = runtime; },
    close() {
      closing ??= (async () => {
        const lobbyClosing = activeLobby?.close();
        await new Promise((resolve) => {
          io.close(resolve);
          httpServer.closeIdleConnections();
        });
        await Promise.all([dependencies?.close(), lobbyClosing]);
      })();
      return closing;
    },
  };
}

export async function start() {
  config({ path: new URL("../.env", import.meta.url), quiet: true });
  const port = Number(process.env.REALTIME_PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("REALTIME_PORT inválida");
  for (const name of ["WEB_ORIGIN", "DATABASE_URL", "REDIS_URL"]) {
    if (!process.env[name])
      throw new Error(`Variável obrigatória ausente: ${name}`);
    new URL(process.env[name]);
  }
  const dependencies = createDependencyChecks({
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
  });
  const database = createDatabase({ databaseUrl: process.env.DATABASE_URL, maxPlayers: Number(process.env.MAX_PLAYERS || 20) });
  let lobby;
  const healthChecker = createHealthChecker({
    checkPostgres: dependencies.checkPostgres,
    checkRedis: async () => dependencies.checkRedis() && (!lobby || lobby.isReady()),
  });
  const server = createRealtimeServer({
    healthChecker,
    dependencies,
    webOrigin: process.env.WEB_ORIGIN,
  });
  lobby = createLobbyRuntime({
    io: server.io,
    database,
    redisUrl: process.env.REDIS_URL,
    maxPlayers: Number(process.env.MAX_PLAYERS || 20),
    ttlSeconds: Number(process.env.LOBBY_TTL_SECONDS || 21600),
  });
  server.setLobby(lobby);
  await lobby.connect();
  try {
    await new Promise((resolve, reject) => {
      server.httpServer.once("error", reject);
      server.httpServer.listen(port, resolve);
    });
    console.info(`[realtime] Servidor iniciado na porta ${port}`);
    const health = await healthChecker();
    console.info("[realtime] Dependências:", health.dependencies);
  } catch (error) {
    await server.close();
    throw error;
  }
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[realtime] Encerrando: ${signal}`);
    const deadline = setTimeout(() => {
      console.error("[realtime] Prazo de encerramento excedido");
      process.exit(1);
    }, 5000);
    deadline.unref();
    try {
      await server.close();
      await database.close();
    } catch {
      console.error("[realtime] Falha no encerramento");
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  start().catch(() => {
    console.error(
      "[realtime] Falha ao iniciar. Confira variáveis, dependências e porta disponível.",
    );
    process.exitCode = 1;
  });
}
