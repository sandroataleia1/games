import { PrismaClient } from "@prisma/client";

export function createClient(databaseUrl) {
  if (!databaseUrl) throw new Error("DATABASE_URL obrigatória");
  const url = new URL(databaseUrl);
  if (!url.searchParams.has("connect_timeout"))
    url.searchParams.set("connect_timeout", "2");
  if (!url.searchParams.has("pool_timeout"))
    url.searchParams.set("pool_timeout", "2");
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

export function createDatabaseHealthProbe(databaseUrl) {
  const client = createClient(databaseUrl);
  return {
    async check() {
      await client.$queryRaw`SELECT 1`;
      return true;
    },
    close() {
      return client.$disconnect();
    },
  };
}
