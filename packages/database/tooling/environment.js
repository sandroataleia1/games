import { config } from "dotenv";

export function loadEnvironment() {
  config({ path: new URL("../.env", import.meta.url), quiet: true });
}

export function isolatedTestUrl() {
  loadEnvironment();
  const development = new URL(process.env.DATABASE_URL);
  const test = new URL(process.env.TEST_DATABASE_URL);
  const schema = test.searchParams.get("schema");
  if (
    schema !== "quizarena_test" ||
    (development.searchParams.get("schema") || "public") === schema
  ) {
    throw new Error(
      "Testes exigem schema exclusivo quizarena_test, diferente do desenvolvimento.",
    );
  }
  if (!["postgresql:", "postgres:"].includes(test.protocol))
    throw new Error("TEST_DATABASE_URL deve usar PostgreSQL.");
  return test.toString();
}
