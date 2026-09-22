import { createDatabaseHealthProbe } from "@quizarena/database";
import { createClient } from "redis";

export function createDependencyChecks({
  databaseUrl,
  redisUrl,
  logger = console,
}) {
  const postgres = createDatabaseHealthProbe(databaseUrl);
  const redis = createClient({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 1500,
      reconnectStrategy: (retries) => Math.min(200 * (retries + 1), 2000),
    },
  });
  redis.on("error", () =>
    logger.error("[redis] Conexão indisponível; tentando reconectar."),
  );
  // Uma conexão compartilhada; checks não iniciam conexões concorrentes.
  const connection = redis.connect().catch(() => {});
  let closing;
  return {
    async checkPostgres() {
      return postgres.check();
    },
    async checkRedis() {
      return redis.isReady && (await redis.ping()) === "PONG";
    },
    close() {
      closing ??= (async () => {
        if (redis.isOpen) redis.destroy();
        await Promise.all([postgres.close(), connection]);
      })();
      return closing;
    },
  };
}
