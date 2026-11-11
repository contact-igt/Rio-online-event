import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.ts";
import { assertConfiguredDatabase, assertMigrateAllowed, assertProductionProcessAllowed, assertProductionSetupAllowed, assertResetAllowed, GuardError, requireDatabase, testEnvironment } from "./guards.ts";

const mysqlEnv = (over: Record<string, string> = {}) => {
  const production = over.NODE_ENV === "production";
  return {
    DB_DIALECT: "mysql",
    DATABASE_URL: production ? "mysql://u:p@db.internal:3306/rio" : "mysql://u:p@127.0.0.1:3306/rio",
    DB_ALLOWED_HOST: production ? "db.internal" : "127.0.0.1",
    DB_ALLOWED_DATABASE: "rio",
    ALLOWED_ORIGINS: "https://admin.example.org", // required by the config in production once a database is configured
    ...(production ? { APP_ENV: "production", DB_ENGINE: "mysql", DB_ALLOWED_DATABASE: "rio" } : {}),
    ...over,
  };
};

describe("assertMigrateAllowed", () => {
  it("lets development and test migrate without confirmation", () => {
    expect(() => assertMigrateAllowed(loadConfig(mysqlEnv()), { DB_ALLOWED_DATABASE: "rio" })).not.toThrow();
  });

  it("uses DB_ALLOWED_DATABASE as the sole configured target identity", () => {
    const config = loadConfig(mysqlEnv({ NODE_ENV: "production" }));
    expect(() => assertMigrateAllowed(config, { DB_ALLOWED_DATABASE: "rio" })).not.toThrow();
    expect(() => assertMigrateAllowed(config, {})).toThrow(/DB_ALLOWED_DATABASE is required/);
    expect(() => assertMigrateAllowed(config, { DB_ALLOWED_DATABASE: "other" })).toThrow(/does not match/);
  });

  it("refuses to run with no database configured", () => {
    expect(() => requireDatabase(loadConfig({}))).toThrow(/No database is configured/);
  });
});

describe("assertConfiguredDatabase", () => {
  it("requires the allowed name to match the configured target", () => {
    const config = loadConfig(mysqlEnv());
    expect(() => assertConfiguredDatabase(config, {})).toThrow(/DB_ALLOWED_DATABASE is required/);
    expect(() => assertConfiguredDatabase(config, { DB_ALLOWED_DATABASE: "other" })).toThrow(/does not match/);
    expect(assertConfiguredDatabase(config, { DB_ALLOWED_DATABASE: "rio" })).toMatchObject({ database: "rio" });
  });
});

describe("assertProductionSetupAllowed", () => {
  it("requires production for the process and the explicit app environment", () => {
    const development = loadConfig(mysqlEnv());
    expect(() => assertProductionSetupAllowed(development, { NODE_ENV: "development", APP_ENV: "development" })).toThrow(GuardError);

    const production = loadConfig(mysqlEnv({ NODE_ENV: "production" }));
    expect(() => assertProductionSetupAllowed(production, { NODE_ENV: "production", APP_ENV: "production", DB_ALLOWED_DATABASE: "rio" })).not.toThrow();
    expect(() => assertProductionSetupAllowed(production, { NODE_ENV: "production", APP_ENV: "development" })).toThrow(GuardError);
  });
});

describe("assertProductionProcessAllowed", () => {
  it("requires production for read-only production CLI commands", () => {
    const production = loadConfig(mysqlEnv({ NODE_ENV: "production" }));
    expect(() => assertProductionProcessAllowed(production, { NODE_ENV: "production", APP_ENV: "production" })).not.toThrow();
    expect(() => assertProductionProcessAllowed(production, { NODE_ENV: "production", APP_ENV: "development" })).toThrow(GuardError);
    expect(() => assertProductionProcessAllowed(loadConfig(mysqlEnv()), { NODE_ENV: "development", APP_ENV: "development" })).toThrow(GuardError);
  });
});

describe("assertResetAllowed", () => {
  const test = { NODE_ENV: "test", DB_DIALECT: "mysql", DATABASE_URL: "mysql://u:p@127.0.0.1:3306/rio_test", DB_ALLOWED_HOST: "127.0.0.1" };

  it("allows a local *_test MySQL database and an in-memory or .test.sqlite SQLite one under NODE_ENV=test", () => {
    expect(assertResetAllowed(loadConfig(test)).dialect).toBe("mysql");
    expect(assertResetAllowed(loadConfig({ NODE_ENV: "test", DB_DIALECT: "sqlite", SQLITE_PATH: ":memory:" })).dialect).toBe("sqlite");
    expect(assertResetAllowed(loadConfig({ NODE_ENV: "test", DB_DIALECT: "sqlite", SQLITE_PATH: "./data/x.test.sqlite" })).dialect).toBe("sqlite");
  });

  it("refuses outside NODE_ENV=test, even for a database that looks harmless", () => {
    expect(() => assertResetAllowed(loadConfig(mysqlEnv()))).toThrow(GuardError);
    expect(() => assertResetAllowed(loadConfig({ NODE_ENV: "development", DB_DIALECT: "sqlite", SQLITE_PATH: "./data/dev.sqlite" }))).toThrow(GuardError);
  });
});

describe("testEnvironment", () => {
  it("reads only RIO_TEST_* names, never DATABASE_URL", () => {
    const env = testEnvironment({ DATABASE_URL: "mysql://prod:secret@prod.example/rio", DB_DIALECT: "mysql" });
    expect(env).toEqual({ NODE_ENV: "test", APP_ENV: "test", DB_DIALECT: "sqlite", SQLITE_PATH: ":memory:" });
    expect(JSON.stringify(env)).not.toContain("prod");
  });

  it("builds a MySQL test target from RIO_TEST_DATABASE_URL, defaulting the allowed host to the loopback address", () => {
    const env = testEnvironment({ RIO_TEST_DATABASE_URL: "mysql://u:p@127.0.0.1:33306/rio_test" });
    expect(loadConfig(env).database).toMatchObject({ dialect: "mysql", host: "127.0.0.1", port: 33306, database: "rio_test" });
  });

  it("cannot be turned into a production target: a remote or non-test database is rejected by the config rules", () => {
    expect(() => loadConfig(testEnvironment({ RIO_TEST_DATABASE_URL: "mysql://u:p@prod.example:3306/rio_test", RIO_TEST_DB_ALLOWED_HOST: "prod.example" }))).toThrow(/local database/);
    expect(() => loadConfig(testEnvironment({ RIO_TEST_DATABASE_URL: "mysql://u:p@127.0.0.1:3306/rio" }))).toThrow(/_test/);
  });
});
