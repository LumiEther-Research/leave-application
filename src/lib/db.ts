// The one Postgres connection pool, reading DATABASE_URL. Created on first use, so importing this never
// needs a database. Works with Neon (use its pooled connection string) or any Postgres.
import { Pool } from "pg";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { retryNetworkErrors } from "./retry";

// Node gives each address 250ms to connect before trying the next, then fails with ETIMEDOUT if all of
// them are slow. On a slow or IPv6-less network that is too tight, so allow more time.
setDefaultAutoSelectFamilyAttemptTimeout?.(2000);

export class DatabaseConfigError extends Error {}

/** The most connections one server instance holds open. */
export const MAX_CONNECTIONS = 5;

// Kept on globalThis so a dev-server hot reload doesn't leave a second pool behind.
const holder = globalThis as typeof globalThis & { __pgPool?: { url: string; pool: Pool } };

function pool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new DatabaseConfigError("DATABASE_URL is not set. Add your Postgres connection string to the environment.");
  if (holder.__pgPool?.url !== url) {
    void holder.__pgPool?.pool.end(); // the URL changed (tests point it at the test branch)
    const created = new Pool({
      connectionString: url,
      max: MAX_CONNECTIONS,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: true, // scripts and tests can finish without closing the pool
    });
    // An idle connection dropped by the server must not crash the process. The next query opens a new one.
    created.on("error", (error) => console.error(`[db] idle connection error: ${error.message}`));
    holder.__pgPool = { url, pool: created };
  }
  return holder.__pgPool.pool;
}

export type Row = Record<string, unknown>;

/**
 * Runs one parameterised query ($1, $2, ...) and returns its rows. A read (select) that fails because
 * the network dropped is tried again a couple of times; a write never is, so it can't run twice.
 */
export async function query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const run = async () => (await pool().query(text, params)).rows as T[];
  return /^\s*(select|with)\b/i.test(text) && !/\b(insert|update|delete)\b/i.test(text)
    ? retryNetworkErrors(run)
    : run();
}

/** Closes the pool. Only needed by code that wants to exit at once. */
export async function closePool() {
  const current = holder.__pgPool;
  holder.__pgPool = undefined;
  await current?.pool.end();
}

/** Postgres error code of a failed query, e.g. "23505" for a unique violation. */
export const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;

/** True for a unique-constraint violation. */
export const isUniqueViolation = (error: unknown) => errorCode(error) === "23505";

/** Ids are uuids. Anything else can't exist, and would make Postgres throw if used in a query. */
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
