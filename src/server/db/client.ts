import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

const globalForDb = globalThis as unknown as { __crmSql?: postgres.Sql; __crmDb?: Database };

function createDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client =
    globalForDb.__crmSql ?? postgres(url, {
      max: Number(process.env.DB_POOL_MAX ?? 10),
      // Transaction-mode poolers (e.g. Neon's pooled endpoint) need prepared statements off.
      prepare: process.env.DB_PREPARE !== "false",
      onnotice: () => {},
    });
  globalForDb.__crmSql = client;
  return drizzle(client, { schema });
}

function getDb(): Database {
  globalForDb.__crmDb ??= createDb();
  return globalForDb.__crmDb;
}

/**
 * Runtime database handle (connects as the non-superuser `crm_app` role, so RLS applies).
 * Created lazily on first use so importing modules never requires a connection.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export async function closeDb() {
  await globalForDb.__crmSql?.end();
  globalForDb.__crmSql = undefined;
  globalForDb.__crmDb = undefined;
}
