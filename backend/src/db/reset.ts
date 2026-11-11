import type { DatabaseAdapter } from "./adapter.ts";

const APP_TABLES = [
  "staff_users", "staff_sessions", "audit_log", "events", "event_settings", "question_sets", "questions", "submissions", "registration_recovery",
  "entry_answers", "duplicate_reviews", "video_uploads", "judge_profiles", "judge_assignments", "scores", "winners", "email_outbox", "rate_limits", "rio_migrations",
];
const APP_VIEWS = ["published_winners"];

export class DropPartialError extends Error {
  override name = "DropPartialError";
  constructor(removed: number) {
    super(`RIO object removal failed after ${removed} object(s); the database may be partially reset. Stop and inspect it before retrying.`);
  }
}

export class ExternalDependencyError extends Error {
  override name = "ExternalDependencyError";
  constructor() {
    super("db:drop found a foreign key dependency from an unrelated table. Nothing was changed.");
  }
}

export type DatabaseObject = { type: "table" | "view" | "trigger"; name: string };

/** Lists only objects owned by the RIO migration set. */
export async function listRioObjects(db: DatabaseAdapter): Promise<DatabaseObject[]> {
  if (db.dialect === "sqlite") {
    const { rows } = await db.query<{ type: DatabaseObject["type"]; name: string }>(
      `SELECT type, name FROM sqlite_master WHERE name IN (${[...APP_TABLES, ...APP_VIEWS].map(() => "?").join(",")}) OR (type = 'trigger' AND tbl_name IN (${APP_TABLES.filter((t) => t !== "rio_migrations").map(() => "?").join(",")})) ORDER BY type, name`,
      [...APP_TABLES, ...APP_VIEWS, ...APP_TABLES.filter((t) => t !== "rio_migrations")],
    );
    return rows;
  }
  const [tables, views, triggers] = await Promise.all([
    db.query<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name IN (" + APP_TABLES.map(() => "?").join(",") + ")", APP_TABLES),
    db.query<{ name: string }>("SELECT table_name AS name FROM information_schema.views WHERE table_schema = DATABASE() AND table_name IN (" + APP_VIEWS.map(() => "?").join(",") + ")", APP_VIEWS),
    db.query<{ name: string }>("SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND event_object_table IN (" + APP_TABLES.filter((t) => t !== "rio_migrations").map(() => "?").join(",") + ")", APP_TABLES.filter((t) => t !== "rio_migrations")),
  ]);
  return [
    ...tables.rows.map(({ name }) => ({ type: "table" as const, name })),
    ...views.rows.map(({ name }) => ({ type: "view" as const, name })),
    ...triggers.rows.map(({ name }) => ({ type: "trigger" as const, name })),
  ].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

/** Refuses to damage unrelated tables that reference an RIO parent table. */
export async function assertNoExternalDependencies(db: DatabaseAdapter): Promise<void> {
  if (db.dialect === "mysql") {
    const result = await db.query("SELECT 1 AS present FROM information_schema.key_column_usage WHERE constraint_schema = DATABASE() AND referenced_table_name IN (" + APP_TABLES.map(() => "?").join(",") + ") AND table_name NOT IN (" + APP_TABLES.map(() => "?").join(",") + ") LIMIT 1", [...APP_TABLES, ...APP_TABLES]);
    if (result.rows.length > 0) throw new ExternalDependencyError();
    return;
  }
  const tables = await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  const app = new Set(APP_TABLES);
  for (const { name } of tables.rows) {
    if (app.has(name)) continue;
    const quoted = `"${name.replace(/"/g, '""')}"`;
    const references = await db.query<{ table: string }>(`PRAGMA foreign_key_list(${quoted})`);
    if (references.rows.some((row) => app.has(row.table))) throw new ExternalDependencyError();
  }
}

// Drops every table in a TEST database (callers must have passed assertResetAllowed). Table names come from the database's own catalogue
// and are quoted; no name is taken from input.
export async function dropAllTables(db: DatabaseAdapter): Promise<number> {
  return db.withConnection(async (connection) => {
    if (db.dialect === "mysql") {
      // Views first: they would otherwise be left pointing at tables that no longer exist.
      const views = await connection.query<{ name: string }>("SELECT table_name AS name FROM information_schema.views WHERE table_schema = DATABASE()");
      for (const { name } of views.rows) await connection.query(`DROP VIEW IF EXISTS \`${name.replace(/`/g, "``")}\``);
      const { rows } = await connection.query<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'");
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      try {
        for (const { name } of rows) await connection.query(`DROP TABLE IF EXISTS \`${name.replace(/`/g, "``")}\``);
      } finally {
        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      }
      return rows.length;
    }
    const views = await connection.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'view'");
    for (const { name } of views.rows) await connection.query(`DROP VIEW IF EXISTS "${name.replace(/"/g, '""')}"`);
    const { rows } = await connection.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
    await connection.query("PRAGMA foreign_keys = OFF");
    try {
      for (const { name } of rows) await connection.query(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
    } finally {
      await connection.query("PRAGMA foreign_keys = ON");
    }
    return rows.length;
  });
}

/** Drops only the fixed RIO object set. The target database itself and unrelated objects remain untouched. */
export async function dropRioObjects(db: DatabaseAdapter): Promise<number> {
  await assertNoExternalDependencies(db);
  const objects = await listRioObjects(db);
  return db.withConnection(async (connection) => {
    let removed = 0;
    try {
    for (const { name } of objects.filter((o) => o.type === "view")) {
      if (db.dialect === "mysql") await connection.query(`DROP VIEW IF EXISTS \`${name.replace(/`/g, "``")}\``);
      else await connection.query(`DROP VIEW IF EXISTS "${name.replace(/"/g, '""')}"`);
      removed++;
    }
    const tables = objects.filter((o) => o.type === "table");
    if (db.dialect === "mysql") await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    else await connection.query("PRAGMA foreign_keys = OFF");
    try {
      for (const { name } of tables) {
        const quoted = db.dialect === "mysql" ? `\`${name.replace(/`/g, "``")}\`` : `"${name.replace(/"/g, '""')}"`;
        await connection.query(`DROP TABLE IF EXISTS ${quoted}`);
        removed++;
      }
    } finally {
      await connection.query(db.dialect === "mysql" ? "SET FOREIGN_KEY_CHECKS = 1" : "PRAGMA foreign_keys = ON");
    }
    return objects.length;
    } catch {
      throw new DropPartialError(removed);
    }
  });
}
