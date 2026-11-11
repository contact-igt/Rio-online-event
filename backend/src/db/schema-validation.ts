import { DatabaseSync } from "node:sqlite";
import type { DatabaseAdapter } from "./adapter.ts";
import type { Migration } from "./migrate.ts";

export type SchemaValidation = { valid: boolean; problems: string[] };

const cleanObjectSql = (sql: string | null) => (sql ?? "").replace(/\s+/g, " ").trim().replace(/;$/, "").toLowerCase();

/** Builds the expected MySQL-protocol column catalog from CREATE and ALTER migration statements. */
export function expectedMysqlColumns(migrations: Migration[]): Map<string, Map<string, string>> {
  const columns = new Map<string, Map<string, string>>();
  const tableColumns = (table: string) => {
    let result = columns.get(table);
    if (!result) columns.set(table, (result = new Map()));
    return result;
  };
  const addColumn = (target: Map<string, string>, name: string, type: string) => target.set(name, type.toLowerCase());

  for (const migration of migrations) for (const statement of migration.statements) {
    const sql = statement.replace(/^--[^\n]*\n/gm, "").trim();
    const create = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z][a-z0-9_]*)`?\s*\(([\s\S]*)\)\s*(?:ENGINE|;|$)/i.exec(sql);
    if (create && !create[1]!.endsWith("_rebuild")) {
      const target = tableColumns(create[1]!);
      for (const line of create[2]!.split(/,\s*\n/)) {
        const col = /^\s*`?([a-z][a-z0-9_]*)`?\s+(BIGINT|INT|SMALLINT|TINYINT|VARCHAR|CHAR|TEXT|DATETIME|JSON|DECIMAL|BOOLEAN|ENUM|DOUBLE|FLOAT)/i.exec(line);
        if (col) addColumn(target, col[1]!, col[2]!);
      }
    }

    const alterTable = /^ALTER\s+TABLE\s+`?([a-z][a-z0-9_]*)`?\s+/i.exec(sql)?.[1];
    if (alterTable) {
      const target = tableColumns(alterTable);
      for (const add of sql.matchAll(/\bADD\s+(?:COLUMN\s+)?`?([a-z][a-z0-9_]*)`?\s+(BIGINT|INT|SMALLINT|TINYINT|VARCHAR|CHAR|TEXT|DATETIME|JSON|DECIMAL|BOOLEAN|ENUM|DOUBLE|FLOAT)/gi)) addColumn(target, add[1]!, add[2]!);
      const modify = /^ALTER\s+TABLE\s+`?[a-z][a-z0-9_]*`?\s+MODIFY\s+`?([a-z][a-z0-9_]*)`?\s+(BIGINT|INT|SMALLINT|TINYINT|VARCHAR|CHAR|TEXT|DATETIME|JSON|DECIMAL|BOOLEAN|ENUM|DOUBLE|FLOAT)/i.exec(sql);
      if (modify) addColumn(target, modify[1]!, modify[2]!);
    }
  }
  return columns;
}

export function mysqlTypeMatches(expected: string, actual: string, mariaDb: boolean): boolean {
  return expected === actual || (mariaDb && expected === "json" && actual === "longtext");
}

export function isMariaDbJsonValidationConstraint(table: string, constraint: string, expected: Map<string, Map<string, string>>, mariaDb: boolean): boolean {
  return mariaDb && expected.get(table)?.get(constraint) === "json";
}

/**
 * Checks the live schema against a clean replay of the same versioned migration files.
 * SQLite is the reference engine for the complete SQL-definition comparison. For the MySQL
 * protocol engine, catalogue checks compare the table, column, index, FK/check constraint,
 * trigger, and view names emitted by the migration stream. No schema is changed here.
 */
export async function validateMigrationSchema(db: DatabaseAdapter, migrations: Migration[], tracking = "rio_migrations", trackingExpected = true): Promise<SchemaValidation> {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(tracking)) return { valid: false, problems: ["migration_tracking_name_invalid"] };
  const expected = db.dialect === "sqlite" ? new DatabaseSync(":memory:") : null;
  try {
    const problems: string[] = [];

    if (db.dialect === "sqlite") {
      expected!.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations) for (const statement of migration.statements) expected!.exec(statement);
      if (trackingExpected) expected!.exec(`CREATE TABLE ${tracking} (version TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, execution_ms INTEGER NOT NULL) STRICT`);
      const expectedObjects = expected!.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as { type: string; name: string; sql: string | null }[];
      const liveRows = await db.query<{ type: string; name: string; sql: string | null }>("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name");
      const live = new Map(liveRows.rows.map((row) => [`${row.type}:${row.name}`, cleanObjectSql(row.sql)]));
      const wanted = new Map(expectedObjects.map((row) => [`${row.type}:${row.name}`, cleanObjectSql(row.sql)]));
      for (const key of wanted.keys()) if (!live.has(key)) problems.push(`missing_${key.replace(":", "_")}`);
      for (const [key, definition] of live) {
        if (!wanted.has(key)) problems.push(`unexpected_${key.replace(":", "_")}`);
        else if (wanted.get(key) !== definition) problems.push(`definition_mismatch_${key.replace(":", "_")}`);
      }
    } else {
      const server = await db.query<{ version: string }>("SELECT VERSION() AS version");
      const mariaDb = /mariadb/i.test(server.rows[0]?.version ?? "");
      const objects = new Map<string, Set<string>>();
      const implicitForeignKeyIndexes = new Set<string>();
      const put = (type: string, name: string) => {
        const names = objects.get(type) ?? new Set<string>();
        names.add(name);
        objects.set(type, names);
      };
      for (const migration of migrations) for (const statement of migration.statements) {
        const sql = statement.replace(/^--[^\n]*\n/gm, "").trim();
        let match = /^CREATE\s+(?:OR\s+REPLACE\s+)?(TABLE|TRIGGER|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z][a-z0-9_]*)`?/i.exec(sql);
        if (match) put(match[1]!.toLowerCase(), match[2]!);
        match = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z][a-z0-9_]*)`?/i.exec(sql);
        if (match) {
          put("index", match[2]!);
          if (match[1]) put("constraint", match[2]!);
        }
        const tableBody = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?[a-z][a-z0-9_]*`?\s*\(([\s\S]*)\)\s*(?:ENGINE|;|$)/i.exec(sql)?.[1];
        if (tableBody) {
          for (const key of tableBody.matchAll(/\b(?:UNIQUE\s+)?KEY\s+`?([a-z][a-z0-9_]*)`?/gi)) put("index", key[1]!);
          for (const key of tableBody.matchAll(/\bUNIQUE\s+KEY\s+`?([a-z][a-z0-9_]*)`?/gi)) put("constraint", key[1]!);
          for (const constraint of tableBody.matchAll(/\bCONSTRAINT\s+`?([a-z][a-z0-9_]*)`?/gi)) put("constraint", constraint[1]!);
          for (const foreignKey of tableBody.matchAll(/\bCONSTRAINT\s+`?([a-z][a-z0-9_]*)`?\s+FOREIGN\s+KEY\s*\(\s*`?([a-z][a-z0-9_]*)`?/gi)) {
            implicitForeignKeyIndexes.add(foreignKey[1]!);
            implicitForeignKeyIndexes.add(foreignKey[2]!);
          }
        }
        match = /^ALTER\s+TABLE\s+`?([a-z][a-z0-9_]*)`?\s+ADD\s+(?:CONSTRAINT\s+`?([a-z][a-z0-9_]*)`?|COLUMN\s+`?([a-z][a-z0-9_]*)`?)/i.exec(sql);
        if (match && match[2]) {
          put("constraint", match[2]);
          const foreignKey = /\bFOREIGN\s+KEY\s*\(\s*`?([a-z][a-z0-9_]*)`?/i.exec(sql);
          if (foreignKey) {
            implicitForeignKeyIndexes.add(match[2]);
            implicitForeignKeyIndexes.add(foreignKey[1]!);
          }
        }
      }
      const expectedTables = new Set(objects.get("table"));
      if (trackingExpected) expectedTables.add(tracking);
      const actualTables = await db.query<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'");
      const expectedViews = objects.get("view") ?? new Set<string>();
      const actualViews = await db.query<{ name: string }>("SELECT table_name AS name FROM information_schema.views WHERE table_schema = DATABASE()");
      const actualTriggers = await db.query<{ name: string }>("SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = DATABASE()");
      const actualIndexes = await db.query<{ name: string }>("SELECT DISTINCT index_name AS name FROM information_schema.statistics WHERE table_schema = DATABASE() AND index_name <> 'PRIMARY'");
      const actualConstraints = await db.query<{ name: string; table: string }>("SELECT DISTINCT constraint_name AS name, table_name AS `table` FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND constraint_name <> 'PRIMARY'");
      const compare = (kind: string, want: Set<string>, got: string[]) => {
        for (const name of want) if (!got.includes(name)) problems.push(`missing_${kind}_${name}`);
        for (const name of got) if (!want.has(name)) problems.push(`unexpected_${kind}_${name}`);
      };
      compare("table", expectedTables, actualTables.rows.map((r) => r.name));
      compare("view", expectedViews, actualViews.rows.map((r) => r.name));
      compare("trigger", objects.get("trigger") ?? new Set(), actualTriggers.rows.map((r) => r.name));
      const namedIndexes = objects.get("index") ?? new Set();
      compare("index", namedIndexes, actualIndexes.rows.map((r) => r.name).filter((name) => namedIndexes.has(name) || !implicitForeignKeyIndexes.has(name)));
      const expectedColumns = expectedMysqlColumns(migrations);
      const actualConstraintNames = actualConstraints.rows
        .filter((row) => !isMariaDbJsonValidationConstraint(row.table, row.name, expectedColumns, mariaDb))
        .map((row) => row.name);
      compare("constraint", objects.get("constraint") ?? new Set(), actualConstraintNames);

      // Every declared column name must exist. Column types are intentionally checked against the
      // migration SQL's declaration token, avoiding comparisons of vendor-specific display formats.
      if (trackingExpected) expectedColumns.set(tracking, new Map([["version", "varchar"], ["name", "varchar"], ["checksum", "char"], ["applied_at", "datetime"], ["execution_ms", "int"]]));
      for (const [table, wanted] of expectedColumns) {
        const columns = await db.query<{ name: string; type: string }>("SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?", [table]);
        const actual = new Map(columns.rows.map((row) => [row.name, row.type.toLowerCase()]));
        for (const [name, type] of wanted) {
          if (!actual.has(name)) problems.push(`missing_column_${table}_${name}`);
          else if (!mysqlTypeMatches(type, actual.get(name)!, mariaDb)) problems.push(`column_type_mismatch_${table}_${name}`);
        }
        for (const name of actual.keys()) if (!wanted.has(name)) problems.push(`unexpected_column_${table}_${name}`);
      }
    }

    return { valid: problems.length === 0, problems: problems.sort() };
  } finally {
    expected?.close();
  }
}
