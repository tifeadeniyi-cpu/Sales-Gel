import { config } from "dotenv";
import { afterAll } from "vitest";

// Process env (e.g. CI) wins; otherwise fall back to .env.test.
config({ path: ".env.test", override: false, quiet: true });

const dbName = new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`Integration tests must run against a *_test database (got "${dbName}")`);
}

afterAll(async () => {
  const { closeDb } = await import("@/server/db/client");
  await closeDb();
});
