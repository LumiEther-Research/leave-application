// The Neon Postgres connection. One HTTP-based client per DATABASE_URL, created on first use,
// so importing this never needs a database and it works in Vercel serverless functions.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { retryNetworkErrors } from "./retry";

// Node gives each address 250ms to connect before trying the next, then fails with ETIMEDOUT if
// all of them are slow. On a slow or IPv6-less network that is too tight, so allow more time.
setDefaultAutoSelectFamilyAttemptTimeout?.(2000);

export class DatabaseConfigError extends Error {}

let cached: { url: string; client: NeonQueryFunction<false, false> } | undefined;

function client(): NeonQueryFunction<false, false> {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new DatabaseConfigError("DATABASE_URL is not set. Add your Neon connection string to the environment.");
  if (cached?.url !== url) cached = { url, client: neon(url) };
  return cached.client;
}

export type Row = Record<string, unknown>;

/**
 * Runs one parameterised query ($1, $2, ...) and returns its rows. A read (select) that fails because
 * the network dropped is tried again a couple of times; a write never is, so it can't run twice.
 */
export async function query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const run = async () => (await client().query(text, params)) as T[];
  return /^\s*(select|with)\b/i.test(text) && !/\b(insert|update|delete)\b/i.test(text)
    ? retryNetworkErrors(run)
    : run();
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
