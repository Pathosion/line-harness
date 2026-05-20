import * as p from "@clack/prompts";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { wrangler, WranglerError } from "../lib/wrangler.js";

interface DatabaseResult {
  databaseId: string;
  databaseName: string;
}

export async function createDatabase(
  repoDir: string,
  databaseName: string,
): Promise<DatabaseResult> {
  const s = p.spinner();

  // Create D1 database — keep this in pipe mode so we can parse the ID and
  // detect the "already exists" case via captured stderr.
  s.start("D1 データベース作成中...");
  let databaseId: string;
  try {
    const output = await wrangler(["d1", "create", databaseName]);
    // Parse database_id from TOML or JSON format
    const tomlMatch = output.match(/database_id\s*=\s*"([^"]+)"/);
    const jsonMatch = output.match(/"database_id"\s*:\s*"([^"]+)"/);
    const uuidMatch = output.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    const match = tomlMatch || jsonMatch || uuidMatch;
    if (!match) {
      throw new Error(`D1 ID をパースできません: ${output}`);
    }
    databaseId = match[1];
    s.stop("D1 データベース作成完了");
  } catch (error) {
    if (
      error instanceof WranglerError &&
      error.stderr.includes("already exists")
    ) {
      s.stop("D1 データベースは既に存在します");
      const listOutput = await wrangler(["d1", "list", "--json"]);
      const databases = JSON.parse(listOutput);
      const db = databases.find(
        (d: { name: string }) => d.name === databaseName,
      );
      if (!db) {
        throw new Error("既存の D1 データベースが見つかりません");
      }
      databaseId = db.uuid;
    } else {
      s.stop("D1 データベース作成失敗");
      throw error;
    }
  }

  // Run base schema first, then migrations
  const schemaFile = join(repoDir, "packages/db/schema.sql");
  const migrationsDir = join(repoDir, "packages/db/migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const totalFiles = 1 + migrationFiles.length;
  s.start(`テーブル作成中（${totalFiles} files）...`);

  // A wrangler error is benign only if it indicates the table/column already
  // exists (i.e. this migration has been applied before). Anything else —
  // including the API never being reached — is a real failure that must
  // surface so the user doesn't end up with an empty database thinking
  // setup succeeded (issue: 'no such table: line_accounts' on Step 12).
  const isBenignSchemaError = (err: unknown): boolean => {
    if (!(err instanceof WranglerError)) return false;
    const text = `${err.message}\n${err.stderr}`.toLowerCase();
    return (
      text.includes("duplicate column") ||
      text.includes("already exists") ||
      text.includes("table") && text.includes("already") // catch "table foo already exists"
    );
  };

  // Base schema (CREATE IF NOT EXISTS for everything in schema.sql — failing
  // here is fatal because subsequent steps assume the core tables exist).
  try {
    await wrangler([
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--file",
      schemaFile,
    ]);
  } catch (err) {
    if (!isBenignSchemaError(err)) {
      s.stop("ベーススキーマ適用に失敗");
      throw err;
    }
  }

  // Migration files — duplicate-column / already-exists are expected on
  // re-runs and resumed installs, but any other error means the migration
  // never ran and we should bail rather than silently advance.
  for (const file of migrationFiles) {
    try {
      await wrangler([
        "d1",
        "execute",
        databaseName,
        "--remote",
        "--file",
        join(migrationsDir, file),
      ]);
    } catch (err) {
      if (!isBenignSchemaError(err)) {
        s.stop(`migration 失敗: ${file}`);
        throw err;
      }
    }
  }

  // Final guard: confirm the core table exists. Catches the silent-failure
  // mode where every wrangler call was rejected (e.g. wrangler.toml had a
  // placeholder account_id and every API call 404'd) and the user would
  // otherwise hit `no such table: line_accounts` two steps later.
  try {
    const verify = await wrangler([
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--command",
      "SELECT name FROM sqlite_master WHERE type='table' AND name='line_accounts'",
    ]);
    if (!verify.includes("line_accounts")) {
      s.stop("テーブル検証失敗");
      throw new Error(
        "schema/migration を適用したのに line_accounts テーブルが見当たりません。手動で `npx wrangler d1 execute " +
          databaseName +
          " --remote --file packages/db/schema.sql` を実行してください。",
      );
    }
  } catch (err) {
    s.stop("テーブル検証失敗");
    throw err;
  }

  s.stop("テーブル作成完了");

  return { databaseId, databaseName };
}
