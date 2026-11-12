/**
 * Bootstrap + migrate + sync permission catalog.
 *   pnpm db:migrate               (uses .env)
 *   DOTENV_CONFIG_PATH=.env.test pnpm db:migrate
 *
 * Runs as the owner role (DATABASE_URL_MIGRATE). In dev/CI it also creates the
 * non-superuser runtime role named in DATABASE_URL if missing.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { ALL_PERMISSIONS, PERMISSIONS, permissionDomain } from "../src/server/authz/catalog";

async function main() {
  const migrateUrl = process.env.DATABASE_URL_MIGRATE;
  const appUrl = process.env.DATABASE_URL;
  if (!migrateUrl || !appUrl) throw new Error("DATABASE_URL and DATABASE_URL_MIGRATE are required");

  const appRole = new URL(appUrl).username;
  const sql = postgres(migrateUrl, { max: 1, onnotice: () => {} });

  // 1. Ensure runtime role exists (dev/CI convenience; production roles are provisioned by ops).
  if (appRole !== "crm_app") {
    throw new Error(`Migrations grant to role "crm_app"; DATABASE_URL uses "${appRole}"`);
  }
  const existing = await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${appRole}`;
  if (existing.length === 0) {
    const password = process.env.APP_DB_PASSWORD;
    if (!password) throw new Error(`Role ${appRole} missing and APP_DB_PASSWORD not set`);
    await sql.unsafe(
      `CREATE ROLE crm_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password.replace(/'/g, "''")}'`,
    );
    console.log("created role crm_app");
  } else if (existing[0].rolsuper || existing[0].rolbypassrls) {
    throw new Error("Runtime role crm_app must not be SUPERUSER or BYPASSRLS — RLS would be bypassed");
  }

  // 2. Migrations
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("migrations applied");

  // 3. Sync permission catalog (upsert + remove stale keys)
  for (const key of ALL_PERMISSIONS) {
    await sql`
      INSERT INTO permissions (key, domain, description)
      VALUES (${key}, ${permissionDomain(key)}, ${PERMISSIONS[key]})
      ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, description = EXCLUDED.description`;
  }
  await sql`DELETE FROM permissions WHERE NOT (key = ANY(${ALL_PERMISSIONS}))`;
  console.log(`permission catalog synced (${ALL_PERMISSIONS.length})`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
