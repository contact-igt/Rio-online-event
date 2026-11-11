import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.ts";
import { assertDropAllowed, assertInteractive, dropConfirmationMatches, GuardError } from "./guards.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { assertNoExternalDependencies, ExternalDependencyError, listRioObjects } from "./reset.ts";
import { migrationsDir } from "./test-schema.ts";
import { openTestDatabase } from "./test-db.ts";

describe("db:drop safeguards", () => {
  const productionEnv = { NODE_ENV: "production", APP_ENV: "production", DB_DIALECT: "mysql", DB_ENGINE: "mariadb", DB_ACCEPT_MARIADB_IN_PRODUCTION: "railway", DB_ALLOWED_HOST: "db.example.test", DB_ALLOWED_DATABASE: "railway", DATABASE_URL: "mysql://u:p@db.example.test:3306/railway", ALLOWED_ORIGINS: "https://admin.example.test" };
  const developmentEnv = { NODE_ENV: "development", APP_ENV: "development", DB_DIALECT: "mysql", DB_ENGINE: "mariadb", DB_ALLOWED_HOST: "localhost", DB_ALLOWED_DATABASE: "rio_local_dev", DATABASE_URL: "mysql://u:p@localhost:3306/rio_local_dev" };

  it("allows only loopback, disposable development targets with matching configured identity", () => {
    expect(() => assertDropAllowed(loadConfig(productionEnv), productionEnv)).toThrow(GuardError);
    expect(() => assertDropAllowed(loadConfig(developmentEnv), developmentEnv)).not.toThrow();
    const sqlite = { NODE_ENV: "development", APP_ENV: "development", DB_DIALECT: "sqlite", SQLITE_PATH: "./rio-local.disposable.dev.sqlite" };
    expect(() => assertDropAllowed(loadConfig(sqlite), sqlite)).not.toThrow();
  });

  it("rejects a wrong or missing database identity and the test environment", () => {
    const wrongName = { ...productionEnv, DB_ALLOWED_DATABASE: "other" };
    expect(() => loadConfig(wrongName)).toThrow(/does not match/);
    const missing: Record<string, string | undefined> = { ...developmentEnv, DB_ALLOWED_DATABASE: undefined };
    expect(() => assertDropAllowed(loadConfig(missing), missing)).toThrow(/DB_ALLOWED_DATABASE is required/);
    const mismatch = { ...developmentEnv, DB_ALLOWED_DATABASE: "rio_other" };
    expect(() => assertDropAllowed(loadConfig(developmentEnv), mismatch)).toThrow(/does not match/);
    const wrongHost = { ...developmentEnv, DB_ALLOWED_HOST: "other.example.test" };
    expect(() => loadConfig(wrongHost)).toThrow(/host does not match/);
    const test = { NODE_ENV: "test", APP_ENV: "test", DB_DIALECT: "sqlite", SQLITE_PATH: ":memory:", DB_ALLOWED_DATABASE: ":memory:" };
    expect(() => assertDropAllowed(loadConfig(test), test)).toThrow(GuardError);
  });

  it("refuses non-interactive execution", () => {
    expect(() => assertInteractive(true, true)).not.toThrow();
    expect(() => assertInteractive(false, true)).toThrow(GuardError);
    expect(() => assertInteractive(true, undefined)).toThrow(GuardError);
  });

  it("requires the exact target confirmation", () => {
    expect(dropConfirmationMatches("railway", "railway")).toBe(true);
    expect(dropConfirmationMatches(" railway \n", "railway")).toBe(true);
    expect(dropConfirmationMatches("DROP railway", "railway")).toBe(false);
    expect(dropConfirmationMatches("Railway", "railway")).toBe(false);
    expect(dropConfirmationMatches("", "railway")).toBe(false);
  });

  it("lists RIO objects and refuses when an unrelated table references them", async () => {
    const db = openTestDatabase("sqlite");
    try {
      const migrations = await loadMigrations(migrationsDir("sqlite"));
      await migrate(db, migrations);
      await db.query("CREATE TABLE unrelated_data (id INTEGER PRIMARY KEY, note TEXT NOT NULL)");
      await db.query("INSERT INTO unrelated_data (id, note) VALUES (1, 'preserve')");
      await db.query("CREATE TABLE external_reference (id INTEGER PRIMARY KEY, staff_id INTEGER REFERENCES staff_users(id))");
      await expect(assertNoExternalDependencies(db)).rejects.toBeInstanceOf(ExternalDependencyError);
      const objects = await listRioObjects(db);
      expect(objects.some((object) => object.type === "trigger" && object.name === "scores_guard_delete")).toBe(true);
      expect(objects.some((object) => object.type === "view" && object.name === "published_winners")).toBe(true);
      expect(objects.some((object) => object.type === "table" && object.name === "rio_migrations")).toBe(true);
      expect((await db.query("SELECT name FROM sqlite_master WHERE name = 'unrelated_data'")).rows).toHaveLength(1);
      expect((await db.query<{ note: string }>("SELECT note FROM unrelated_data WHERE id = 1")).rows[0]?.note).toBe("preserve");
    } finally {
      await db.close();
    }
  }, 30_000);
});
