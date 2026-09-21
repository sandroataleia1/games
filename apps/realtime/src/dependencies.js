import pg from "pg";
import { createClient } from "redis";

export function createDependencyChecks({
  databaseUrl,
  redisUrl,
  logger = console,
}) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 1500,
    query_timeout: 1500,
  });
  pool.on("error", () =>
    logger.error(
      "[postgres] Conexão indisponível; nova tentativa no próximo check.",
    ),
  );
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
      await pool.query("SELECT 1");
      return true;
    },
    async checkRedis() {
      return redis.isReady && (await redis.ping()) === "PONG";
    },
    close() {
      closing ??= (async () => {
        if (redis.isOpen) redis.destroy();
        await Promise.all([pool.end(), connection]);
      })();
      return closing;
    },
  };
}
