/** Drops and recreates the public + drizzle schemas. Refuses to run unless the DB name ends in _test. */
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL_MIGRATE!;
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to reset non-test database "${dbName}"`);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await sql.end();
  console.log(`reset ${dbName}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
