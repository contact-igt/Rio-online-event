import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadMigrations, migrate } from "./migrate.ts";
import { expectedMysqlColumns, isMariaDbJsonValidationConstraint, mysqlTypeMatches, validateMigrationSchema } from "./schema-validation.ts";
import { migrationsDir } from "./test-schema.ts";
import { openTestDatabase } from "./test-db.ts";

describe("validateMigrationSchema", () => {
  it("includes columns added by versioned ALTER TABLE migrations in the expected MySQL schema", async () => {
    const migrations = await loadMigrations(fileURLToPath(new URL("../../migrations/mariadb", import.meta.url)));
    const questions = expectedMysqlColumns(migrations).get("questions");
    expect(questions?.get("active")).toBe("tinyint");
    expect(questions?.get("min_choices")).toBe("tinyint");
    expect(questions?.get("max_choices")).toBe("tinyint");
  });

  it("accepts MariaDB's LONGTEXT JSON alias and ignores only its implicit JSON validity checks", async () => {
    const migrations = await loadMigrations(fileURLToPath(new URL("../../migrations/mariadb", import.meta.url)));
    const columns = expectedMysqlColumns(migrations);
    expect(mysqlTypeMatches("json", "longtext", true)).toBe(true);
    expect(mysqlTypeMatches("json", "longtext", false)).toBe(false);
    expect(isMariaDbJsonValidationConstraint("questions", "options_json", columns, true)).toBe(true);
    expect(isMariaDbJsonValidationConstraint("questions", "questions_options_ck", columns, true)).toBe(false);
    expect(isMariaDbJsonValidationConstraint("entry_answers", "value_json", columns, true)).toBe(true);
  });

  it("accepts the complete schema and detects a migration record that is behind the actual schema", async () => {
    const db = openTestDatabase("sqlite");
    try {
      const migrations = await loadMigrations(migrationsDir("sqlite"));
      await migrate(db, migrations, "zz_schema_validation");
      expect(await validateMigrationSchema(db, migrations, "zz_schema_validation")).toEqual({ valid: true, problems: [] });
      await db.query("DELETE FROM zz_schema_validation WHERE version = '0013'");
      const prior = migrations.filter((migration) => migration.version !== "0013");
      expect((await validateMigrationSchema(db, prior, "zz_schema_validation")).problems).toContain("definition_mismatch_table_staff_users");
    } finally {
      await db.close();
    }
  });
});
