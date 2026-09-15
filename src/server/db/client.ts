import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

type Schema = typeof schema;

/**
 * One pool for the whole process, built lazily on first real use rather than
 * at import time. That matters for anything that imports this module without
 * necessarily using it (e.g. an integration test file gated behind
 * DATABASE_URL and skipped via `describe.skipIf` when it's unset) — a
 * top-level `drizzle(...)` call would throw on import regardless of whether
 * any query ever runs.
 */
const globalForDb = globalThis as unknown as { pgPool?: Pool; drizzleDb?: NodePgDatabase<Schema> };

function getDb(): NodePgDatabase<Schema> {
  if (!globalForDb.drizzleDb) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env and point it at a real Postgres instance.",
      );
    }
    // Default pool max (10) is tight once a handful of requests each hold a
    // client for the duration of a transaction — bump it a bit.
    globalForDb.pgPool = new Pool({ connectionString, max: 20 });
    globalForDb.drizzleDb = drizzle({ client: globalForDb.pgPool, schema });
  }
  return globalForDb.drizzleDb;
}

export const db: NodePgDatabase<Schema> = new Proxy({} as NodePgDatabase<Schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export type Db = typeof db;
