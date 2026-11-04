// Test harness for the database-backed suites. They run against a Neon *test branch*, never the real
// database: the connection string must be in DATABASE_URL_TEST (shell or .env.local), it must point
// somewhere other than DATABASE_URL, and the schema must already be applied (npm run db:migrate:test).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "./db";

function loadEnvLocal() {
  const file = join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
loadEnvLocal();

const hostOf = (url: string | undefined) => {
  try {
    return new URL(url ?? "").hostname;
  } catch {
    return undefined;
  }
};

const testUrl = process.env.DATABASE_URL_TEST;
const realUrl = process.env.DATABASE_URL;

/** Why the database suites can't run, or false if they can. Used as `describe(name, { skip }, ...)`. */
export const DB_TEST_SKIP: string | false = !testUrl
  ? "DATABASE_URL_TEST is not set. Create a Neon test branch, run `npm run db:migrate:test`, and set it to run these tests."
  : realUrl && (testUrl === realUrl || hostOf(testUrl) === hostOf(realUrl))
    ? "DATABASE_URL_TEST points at the same database as DATABASE_URL. Refusing to run: these tests empty the tables."
    : false;

if (DB_TEST_SKIP) {
  console.warn(`\n⚠️  Skipping the database tests. ${DB_TEST_SKIP}\n`);
} else {
  // Everything in ./db now talks to the test branch.
  process.env.DATABASE_URL = testUrl;
}

/** Empties every table the tests write to and puts the category days back to the seeded 24. Seeded holidays stay. */
export async function resetDb() {
  if (DB_TEST_SKIP) throw new Error(DB_TEST_SKIP);
  await query("truncate permissions, leave_requests, comp_off_claims, employees, admins restart identity cascade");
  await query("update leave_categories set days_per_year = 24");
}
