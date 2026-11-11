import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";
import { assertNoLocalEnvFile, GuardError } from "./db/guards.ts";
import { assertDatabaseName } from "./db/engine.ts";
import type { DatabaseAdapter } from "./db/adapter.ts";

// Environment-based database selection. Every connection string below is fake; nothing here opens a connection.

const dev = { NODE_ENV: "development", APP_ENV: "development", DB_DIALECT: "mysql", DB_ENGINE: "mariadb", DB_ALLOWED_HOST: "127.0.0.1", DATABASE_URL: "mysql://dev_user:dev-pw@127.0.0.1:3306/rio_hospital" };
const prod = { NODE_ENV: "production", APP_ENV: "production", DB_DIALECT: "mysql", DB_ENGINE: "mysql", DB_ALLOWED_HOST: "mysql.example-host.test", DB_ALLOWED_DATABASE: "rio_prod", DATABASE_URL: "mysql://prod_user:prod-pw@mysql.example-host.test:3306/rio_prod", ALLOWED_ORIGINS: "https://admin.example.org" };
const test = { NODE_ENV: "test", APP_ENV: "test", DB_DIALECT: "mysql", DB_ENGINE: "mariadb", DB_ALLOWED_HOST: "127.0.0.1", DATABASE_URL: "mysql://t:t@127.0.0.1:3306/rio_abc_test" };

const failure = (env: Record<string, string>): string => {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.message;
    throw error;
  }
  throw new Error("expected loadConfig to throw");
};
const without = (env: Record<string, string>, name: string) => Object.fromEntries(Object.entries(env).filter(([k]) => k !== name));

describe("environment-based database selection", () => {
  it("development selects the local MariaDB", () => {
    expect(loadConfig(dev).database).toMatchObject({ engine: "mariadb", host: "127.0.0.1", database: "rio_hospital" });
  });
  it("production selects the configured hosted MySQL 8", () => {
    expect(loadConfig(prod).database).toMatchObject({ engine: "mysql", host: "mysql.example-host.test", database: "rio_prod" });
  });
  it("test selects only an isolated *_test database and never rio_hospital", () => {
    expect(loadConfig(test).database).toMatchObject({ database: "rio_abc_test" });
    expect(failure({ ...test, DATABASE_URL: "mysql://t:t@127.0.0.1:3306/rio_hospital" })).toContain("never a test target");
  });

  it("production without a database URL fails, and never falls back to anything else", () => {
    expect(failure(without(prod, "DATABASE_URL"))).toContain("DATABASE_URL: is required");
    expect(failure(without(prod, "DB_ALLOWED_HOST"))).toContain("DB_ALLOWED_HOST");
  });
  it("rejects a local URL in production", () => {
    expect(failure({ ...prod, DATABASE_URL: "mysql://u:p@127.0.0.1:3306/rio_prod", DB_ALLOWED_HOST: "127.0.0.1" })).toContain("must not be a local database in production");
    expect(failure({ ...prod, DATABASE_URL: "mysql://u:p@localhost:3306/rio_prod", DB_ALLOWED_HOST: "localhost" })).toContain("must not be a local database in production");
  });
  it("rejects a production host in development", () => {
    expect(failure({ ...dev, DATABASE_URL: "mysql://u:p@mysql.example-host.test:3306/rio_hospital", DB_ALLOWED_HOST: "mysql.example-host.test" })).toContain("must point at a local database when NODE_ENV=development");
  });
  it("rejects an engine mismatch: mariadb in production, an implicit engine in production", () => {
    expect(failure({ ...prod, DB_ENGINE: "mariadb" })).toContain("DB_ENGINE");
    expect(failure(without(prod, "DB_ENGINE"))).toContain("DB_ENGINE: must be set explicitly in production");
    expect(loadConfig({ ...prod, DB_ENGINE: "mariadb", DB_ACCEPT_MARIADB_IN_PRODUCTION: "rio_prod" }).database).toMatchObject({ engine: "mariadb" });
    expect(failure({ ...prod, DB_ENGINE: "mariadb", DB_ACCEPT_MARIADB_IN_PRODUCTION: "other_db" })).toContain("mariadb is refused in production");
  });
  it("rejects NODE_ENV and APP_ENV disagreeing, and a production database without APP_ENV=production", () => {
    expect(failure({ ...prod, APP_ENV: "development" })).toContain("APP_ENV: must equal NODE_ENV");
    expect(failure({ ...dev, APP_ENV: "production" })).toContain("APP_ENV: must equal NODE_ENV");
    expect(failure(without(prod, "APP_ENV"))).toContain("APP_ENV: must be production");
  });
  it("NODE_ENV=production alone authorises nothing: an explicit approved database name is required and must match", () => {
    expect(failure(without(prod, "DB_ALLOWED_DATABASE"))).toContain("DB_ALLOWED_DATABASE: is required");
    expect(failure({ ...prod, DB_ALLOWED_DATABASE: "other_db" })).toContain("DB_ALLOWED_DATABASE: does not match");
  });
  it("has no silent fallback: an incomplete production setting fails instead of becoming development", () => {
    expect(failure({ NODE_ENV: "production", APP_ENV: "production", DB_DIALECT: "mysql" })).toContain("DATABASE_URL: is required");
    expect(failure({ ...prod, DB_DIALECT: "sqlite", SQLITE_PATH: "./x.sqlite" })).toContain("sqlite is not allowed in production");
  });
  it("needs no database settings at all to build or to load (the build is tsc and never reads them)", () => {
    expect(loadConfig({}).database).toBeNull();
  });
  it("never puts a password or URL into an error", () => {
    const text = failure({ ...prod, DATABASE_URL: "mysql://prod_user:prod-pw@mysql.example-host.test:3306/other", APP_ENV: "development" });
    expect(text).not.toMatch(/prod-pw|prod_user|mysql\.example-host/);
  });
});

describe("production never reads a local secret file", () => {
  it("refuses a run in production while .env.local exists, and allows development", () => {
    expect(() => assertNoLocalEnvFile(loadConfig(prod), true)).toThrow(GuardError);
    expect(() => assertNoLocalEnvFile(loadConfig(prod), false)).not.toThrow();
    expect(() => assertNoLocalEnvFile(loadConfig(dev), true)).not.toThrow();
  });
});

describe("assertDatabaseName", () => {
  const fake = (name: string | null) => ({ query: async () => ({ rows: [{ d: name }], affectedRows: 0 }) }) as unknown as DatabaseAdapter;
  it("accepts the approved database and refuses any other", async () => {
    const database = loadConfig(prod).database!;
    await expect(assertDatabaseName(fake("rio_prod"), database)).resolves.toBeUndefined();
    await expect(assertDatabaseName(fake("rio_hospital"), database)).rejects.toThrow(GuardError);
    await expect(assertDatabaseName(fake(null), database)).rejects.toThrow(GuardError);
  });
});

describe("the dev and start scripts", () => {
  it("dev loads .env, start loads no env file, nothing runs migrations", async () => {
    const scripts = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts.dev).toContain("--env-file-if-exists=.env ");
    expect(scripts.start).not.toMatch(/env-file|\.env/);
    expect(scripts.build).not.toMatch(/env|migrate|db:/);
    for (const name of ["dev", "start", "build"]) expect(scripts[name]).not.toMatch(/migrate/);
  });
});
