// Applies db/migrations/*.sql, oldest first, to the database in DATABASE_URL
// (or DATABASE_URL_TEST with --test). Each file runs as one transaction and is
// recorded in schema_migrations, so running this again does nothing.
//   npm run db:migrate         # DATABASE_URL
//   npm run db:migrate:test    # DATABASE_URL_TEST
import pg from "pg";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Same variables Next reads from .env.local, loaded here without a dotenv package.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

const useTest = process.argv.includes("--test");
const name = useTest ? "DATABASE_URL_TEST" : "DATABASE_URL";
const url = process.env[name];
if (!url) {
  console.error(`${name} is not set. Put the Neon connection string in .env.local or the environment.`);
  process.exit(1);
}
if (useTest && url === process.env.DATABASE_URL) {
  console.error("DATABASE_URL_TEST must be a different database (a Neon test branch) from DATABASE_URL.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));

const dir = join(process.cwd(), "db", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
let applied = 0;
for (const file of files) {
  if (done.has(file)) continue;
  const statements = readFileSync(join(dir, file), "utf8")
    .split(/^-- split\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    await client.query("begin");
    for (const statement of statements) await client.query(statement);
    await client.query("insert into schema_migrations (name) values ($1)", [file]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  console.log(`applied ${file}`);
  applied++;
}
console.log(applied ? `Done: ${applied} migration(s) applied.` : "Already up to date.");
await client.end();
