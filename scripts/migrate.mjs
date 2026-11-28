#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, `pg`).
 *
 * Runs during `npm run build` — on every Vercel deploy — applying pending files
 * in ../migrations to DATABASE_URL. Each file is applied in one transaction and
 * recorded in a `_migrations` table, so it runs once and is safe to re-run.
 *
 * The read is non-recursive, so the opt-in auth schema under migrations/auth/
 * is not applied to an app that never asked for sign-in.
 *
 * No DATABASE_URL (local / preview builds) -> skip; the PGLite fallback applies
 * the same files at startup instead (see src/lib/db.ts).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { pendingMigrations } from "./migration-plan.mjs";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();
const databaseUrl =
  process.env.STORAGE_DATABASE_URL?.trim() ||
  process.env.STORAGE_POSTGRES_URL?.trim() ||
  process.env.PRISMA_DATABASE_URL?.trim() ||
  process.env.PRISMA_POSTGRES_URL?.trim() ||
  process.env.PRISMA_URL?.trim() ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL;
if (tursoUrl && tursoToken) {
  await migrarTurso(tursoUrl, tursoToken);
  process.exit(0);
}
if (!databaseUrl) {
  console.log(
    "[migrate] DATABASE_URL not set — skipping (the PGLite fallback migrates itself).",
  );
  process.exit(0);
}

async function lerArquivos() {
  try {
    return await readdir(migrationsDir);
  } catch {
    return null;
  }
}

async function migrarTurso(url, authToken) {
  const entries = await lerArquivos();
  if (!entries) {
    console.log("[migrate] no migrations/ directory — nothing to do.");
    return;
  }
  if (pendingMigrations(entries, []).length === 0) {
    console.log("[migrate] no migrations — nothing to do.");
    return;
  }
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url, authToken });
  await client.execute(
    "create table if not exists _migrations (name text primary key, applied_at text not null default (datetime('now')))",
  );
  const feitas = await client.execute("select name from _migrations");
  const applied = feitas.rows.map((row) => String(row.name));
  let count = 0;
  for (const { name } of pendingMigrations(entries, applied)) {
    const text = (await readFile(join(migrationsDir, name), "utf8"))
      .replace(/\bjsonb\b/gi, "text")
      .replace(/add column if not exists/gi, "add column");
    const partes = text.split(";").map((parte) => parte.trim()).filter(Boolean);
    for (const parte of partes) {
      try {
        await client.execute(parte);
      } catch (err) {
        const mensagem = err instanceof Error ? err.message : String(err);
        if (!/duplicate column/i.test(mensagem)) throw err;
      }
    }
    await client.execute({ sql: "insert into _migrations (name) values (?)", args: [name] });
    console.log(`[migrate] applied ${name}`);
    count += 1;
  }
  console.log(count ? `[migrate] turso done — ${count} migration(s) applied.` : "[migrate] turso up to date.");
}

async function main() {
  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch {
    console.log("[migrate] no migrations/ directory — nothing to do.");
    return;
  }
  // An app with no schema of its own must not pay for a database connection.
  if (pendingMigrations(entries, []).length === 0) {
    console.log("[migrate] no migrations — nothing to do.");
    return;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = (await client.query("SELECT name FROM _migrations")).rows.map(
      (r) => r.name,
    );

    let count = 0;
    for (const { name } of pendingMigrations(entries, applied)) {
      const text = await readFile(join(migrationsDir, name), "utf8");
      try {
        await client.query("BEGIN");
        // pg's simple-query protocol runs a whole multi-statement file at once.
        await client.query(text);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        console.error(`[migrate] error applying ${name}`);
        try {
          await client.query("ROLLBACK");
        } catch {
          // ROLLBACK fails when the connection died — keep the original error.
        }
        throw err;
      }
      console.log(`[migrate] applied ${name}`);
      count += 1;
    }
    console.log(count ? `[migrate] done — ${count} migration(s) applied.` : "[migrate] up to date.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  // pg errors carry the context needed to debug a bad SQL file.
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
