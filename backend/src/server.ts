import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { createApp, type AppState } from "./app.ts";
import { ConfigError, loadConfig, type Config } from "./config.ts";
import { assertDatabaseName, assertEngineMatches } from "./db/engine.ts";
import { assertNoLocalEnvFile, GuardError } from "./db/guards.ts";
import { openDatabase } from "./db/open.ts";
import { createLogger } from "./logger.ts";
import { createShutdown } from "./shutdown.ts";

// Process entry point: configuration, listening, signals. Everything testable lives in the modules above.

let config;
try {
  config = loadConfig(process.env);
  assertNoLocalEnvFile(config, existsSync(".env.local"));
} catch (error) {
  // Names and fixed messages only (see config.ts); safe to print.
  process.stderr.write(`${error instanceof ConfigError || error instanceof GuardError ? error.message : "Configuration could not be read."}\n`);
  process.exit(1);
}

const logger = createLogger({ level: config.logLevel });
const state: AppState = { shuttingDown: false };
// The pool opens connections on first use, so a database that is down shows up as sanitised errors on the staff routes, not as a crash here.
const db = config.database ? openDatabase(config.database) : undefined;
if (db && config.registration.publicOrigins.length === 0) logger.warn("public_origins_not_configured"); // registration changes will be refused until PUBLIC_ORIGINS is set
// Fail closed on the wrong server or the wrong database. An unreachable database is not fatal here (see above); a reachable but wrong one is.
if (db && config.database) {
  try {
    await assertEngineMatches(db, config.database);
    await assertDatabaseName(db, config.database);
  } catch (error) {
    if (error instanceof GuardError) {
      process.stderr.write(`${error.message}\n`);
      await db.close();
      process.exit(1);
    }
    logger.warn("database_unreachable_at_startup");
  }
}
const server = createServer(createApp({ config, logger, state, ...(db ? { db } : {}) }));

// Longer than the proxy's idle timeout (Railway and most load balancers use 60 s), so the proxy never reuses a socket we just closed.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

const shutdown = createShutdown({ server, state, logger, timeoutMs: config.shutdownTimeoutMs, onClosed: async () => void (await db?.close()) });
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => void shutdown(signal).then((result) => process.exit(result === "closed" ? 0 : 1)));
}
process.on("uncaughtException", (error) => {
  logger.error("uncaught_exception", { error });
  void shutdown("uncaughtException").then(() => process.exit(1));
});
process.on("unhandledRejection", (error) => {
  logger.error("unhandled_rejection", { error });
  void shutdown("unhandledRejection").then(() => process.exit(1));
});

server.listen(config.port, config.host, () => {
  logger.info("listening", { host: config.host, port: config.port, env: config.env });
  void printStartupSummary(config);
});

// Human-readable status for the terminal. Host, port and database name only: never the user, password or DATABASE_URL.
async function printStartupSummary(config: Config): Promise<void> {
  const target = config.database;
  const dbLine = !target
    ? "not configured"
    : target.dialect === "sqlite"
      ? "sqlite (local file)"
      : `${target.engine} at ${target.host}:${target.port}, database "${target.database}"`;
  let dbStatus = "n/a";
  if (db) {
    try {
      await db.query("SELECT 1");
      dbStatus = "CONNECTED";
    } catch {
      dbStatus = "NOT CONNECTED (check that the database server is running and DATABASE_URL is right)";
    }
  }
  process.stdout.write(
    ["", `  Backend  : running on http://${config.host}:${config.port} (${config.env})`, `  Database : ${dbLine}`, `  DB status: ${dbStatus}`, ""].join("\n"),
  );
}
