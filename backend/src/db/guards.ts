import { parseMysqlUrl, type Config, type DatabaseConfig } from "../config.ts";

// Extra checks for the command-line tools. loadConfig() already refuses unsafe targets; these add the "are you sure" layer for the two
// commands that change a database.

export class GuardError extends Error {
  override name = "GuardError";
}

export function requireDatabase(config: Config): DatabaseConfig {
  if (!config.database) throw new GuardError("No database is configured (set DB_DIALECT and its settings).");
  return config.database;
}

/** The explicitly named database is mandatory for every operational CLI command. */
export function assertConfiguredDatabase(config: Config, env: Record<string, string | undefined>): DatabaseConfig {
  const db = requireDatabase(config);
  // SQLite has no server-side database name; SQLITE_PATH is its explicit identity and is required by loadConfig.
  if (db.dialect === "sqlite") return db;
  if (!env.DB_ALLOWED_DATABASE) throw new GuardError("DB_ALLOWED_DATABASE is required for database CLI commands.");
  if (env.DB_ALLOWED_DATABASE !== targetName(db)) throw new GuardError("DB_ALLOWED_DATABASE does not match the configured database target.");
  return db;
}

/** Production takes its settings from the hosting platform only. A leftover .env.local would let a developer's values leak into it. */
export function assertNoLocalEnvFile(config: Config, localEnvFileExists: boolean): void {
  if (config.env === "production" && localEnvFileExists) throw new GuardError("A .env.local file exists in a production run. Production reads the hosting platform's variables only; remove the file.");
}

const targetName = (db: DatabaseConfig): string => (db.dialect === "mysql" ? db.database : db.path);

/** db:drop is limited to explicitly disposable development databases and always checks the configured target identity. */
export function assertDropAllowed(config: Config, env: Record<string, string | undefined>): DatabaseConfig {
  if (config.env !== "development") throw new GuardError("db:drop is development-only; production and test targets are refused.");
  const db = assertConfiguredDatabase(config, env);
  if (db.dialect === "mysql") {
    if (!/^rio_[a-z0-9_]+_(?:dev|disposable)$/.test(db.database)) throw new GuardError("db:drop is allowed only for an approved disposable development database.");
    if (!new Set(["localhost", "127.0.0.1", "::1"]).has(db.host.toLowerCase())) throw new GuardError("db:drop refuses a non-loopback database host.");
  } else if (!/^rio-[a-z0-9_-]+\.disposable\.dev\.sqlite$/.test(db.path.split(/[\\/]/).at(-1) ?? "")) {
    throw new GuardError("db:drop is allowed only for an approved disposable development database.");
  }
  return db;
}

/** The confirmation prompt needs a person at a terminal; piped or scheduled runs are refused. */
export function assertInteractive(inputIsTty: boolean | undefined, outputIsTty: boolean | undefined): void {
  if (!inputIsTty || !outputIsTty) throw new GuardError("db:drop needs an interactive terminal and will not run non-interactively. Nothing was changed.");
}

export const dropConfirmationMatches = (answer: string, target: string): boolean => answer.trim() === target;

/** The approved DB_ALLOWED_DATABASE identity replaces separate migration confirmation flags. */
export function assertMigrateAllowed(config: Config, env: Record<string, string | undefined>): void {
  assertConfiguredDatabase(config, env);
}

/** Production-only CLI commands must use the hosting process environment, never a developer env file. */
export function assertProductionProcessAllowed(config: Config, env: Record<string, string | undefined>): void {
  if (config.env !== "production" || env.NODE_ENV !== "production" || env.APP_ENV !== "production") {
    throw new GuardError("Production CLI commands require NODE_ENV=production and APP_ENV=production.");
  }
}

/** The production setup entrypoint is deliberately stricter than the general migration command. */
export function assertProductionSetupAllowed(config: Config, env: Record<string, string | undefined>): void {
  assertProductionProcessAllowed(config, env);
  assertMigrateAllowed(config, env);
}

/** The approved database identity guards staff account CLI operations without a second confirmation variable. */
export function assertStaffCliAllowed(config: Config, env: Record<string, string | undefined>): void {
  assertConfiguredDatabase(config, env);
}

/** Resetting drops every table, so it is allowed only for a test database under NODE_ENV=test (config.ts already limits what that can be). */
export function assertResetAllowed(config: Config): DatabaseConfig {
  const db = requireDatabase(config);
  if (config.env !== "test") throw new GuardError("db:reset:test only runs with NODE_ENV=test.");
  if (db.dialect === "mysql" && !db.database.endsWith("_test")) throw new GuardError("db:reset:test only runs on a database whose name ends with _test.");
  if (db.dialect === "sqlite" && db.path !== ":memory:" && !db.path.endsWith(".test.sqlite")) throw new GuardError("db:reset:test only runs on a .test.sqlite file.");
  return db;
}

/**
 * The environment the reset command and the integration tests use. It reads only RIO_TEST_* names, never DATABASE_URL, so a development or
 * production connection string in the shell can never be reached from a test run.
 */
export function testEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const url = env.RIO_TEST_DATABASE_URL;
  const target = url ? parseMysqlUrl(url)?.database : undefined;
  return {
    NODE_ENV: "test",
    APP_ENV: "test",
    ...(url
      ? { DB_DIALECT: "mysql", DATABASE_URL: url, DB_ALLOWED_HOST: env.RIO_TEST_DB_ALLOWED_HOST ?? "127.0.0.1", ...(target ? { DB_ALLOWED_DATABASE: target } : {}), ...(env.RIO_TEST_DB_ENGINE ? { DB_ENGINE: env.RIO_TEST_DB_ENGINE } : {}) }
      : { DB_DIALECT: "sqlite", SQLITE_PATH: env.RIO_TEST_SQLITE_PATH ?? ":memory:" }),
  };
}
