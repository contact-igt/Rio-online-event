import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { stdin, stdout } from "node:process";
import { ConfigError, loadConfig } from "../config.ts";
import { existsSync } from "node:fs";
import { assertDatabaseName, assertEngineMatches, migrationFolder } from "./engine.ts";
import { DatabaseError } from "./errors.ts";
import { assertConfiguredDatabase, assertDropAllowed, assertInteractive, assertMigrateAllowed, assertNoLocalEnvFile, assertResetAllowed, dropConfirmationMatches, GuardError, requireDatabase, testEnvironment } from "./guards.ts";
import { checkParity, getStatus, loadMigrations, migrate, MigrationError, problemsOf, trackingTableExists } from "./migrate.ts";
import { checkReadiness } from "./readiness.ts";
import { openDatabase } from "./open.ts";
import { assertNoExternalDependencies, DropPartialError, dropAllTables, dropRioObjects, ExternalDependencyError, listRioObjects } from "./reset.ts";
import { validateMigrationSchema } from "./schema-validation.ts";

// An empty environment is intentional: only these explicit commands read backend/.env via the npm script.
const ROOT = fileURLToPath(new URL("../../migrations", import.meta.url));
const out = (line: string) => process.stdout.write(`${line}\n`);
const targetLabel = (database: ReturnType<typeof requireDatabase>) => database.dialect === "mysql" ? database.database : database.path;
async function confirmDrop(target: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return dropConfirmationMatches(await rl.question(`Type ${target} to continue: `), target);
  } finally {
    rl.close();
  }
}

async function main(command: string | undefined): Promise<number> {
  if (command === "reset-test") {
    const config = loadConfig(testEnvironment(process.env));
    const db = openDatabase(assertResetAllowed(config));
    try {
      out(`Dropped ${await dropAllTables(db)} table(s) from the test database.`);
    } finally {
      await db.close();
    }
    return 0;
  }
  if (command !== "migrate" && command !== "status" && command !== "drop" && command !== "verify" && command !== "ready") {
    out("Usage: npm run migrate | npm run db:status | npm run db:drop");
    return 2;
  }

  const parity = await checkParity(ROOT);
  if (parity.length > 0) {
    parity.forEach((p) => out(`PROBLEM ${p}`));
    return 1;
  }
  if (command === "verify") {
    out("Dialect folders match.");
    return 0;
  }

  const config = loadConfig(process.env);
  assertNoLocalEnvFile(config, existsSync(".env.local"));
  const database = assertConfiguredDatabase(config, process.env);
  const migrations = await loadMigrations(`${ROOT}/${migrationFolder(database)}`);
  if (command === "migrate") assertMigrateAllowed(config, process.env);
  if (command === "drop") {
    assertDropAllowed(config, process.env);
    assertInteractive(stdin.isTTY, stdout.isTTY);
  }
  const db = openDatabase(database);
  try {
    await assertDatabaseName(db, database);
    await assertEngineMatches(db, database);

    if (command === "drop") {
      await assertNoExternalDependencies(db);
      const objects = await listRioObjects(db);
      const target = targetLabel(database);
      out(`Target database: ${target}`);
      out(`Environment: ${config.env}`);
      if (objects.length === 0) out("RIO objects: none");
      else for (const object of objects) out(`Would remove ${object.type}: ${object.name}`);
      out(`Total tables to delete: ${objects.filter((object) => object.type === "table").length}`);
      out("The database itself is kept. Migrations and seeds are not run afterwards.");
      if (!(await confirmDrop(target))) {
        out("Confirmation not received. Nothing was changed.");
        return 1;
      }
      const count = await dropRioObjects(db);
      out(`Removed ${count} RIO object(s).`);
      return 0;
    }

    if (command === "migrate") {
      const before = await getStatus(db, migrations, undefined, { readOnly: true });
      const historyProblems = problemsOf(before);
      if (historyProblems.length > 0) {
        historyProblems.forEach((problem) => out(`PROBLEM ${problem}`));
        return 1;
      }
      const hasHistory = await trackingTableExists(db);
      const applied = migrations.filter((migration) => before.some((row) => row.version === migration.version && row.state === "applied"));
      const priorSchema = await validateMigrationSchema(db, applied, undefined, hasHistory);
      if (!priorSchema.valid) {
        priorSchema.problems.forEach((problem) => out(`SCHEMA_DRIFT ${problem}`));
        return 1;
      }
      const pending = before.filter((row) => row.state === "pending");
      out(`Preflight: ${pending.length} pending; schema valid.`);
      const result = await migrate(db, migrations);
      const finalSchema = await validateMigrationSchema(db, migrations, undefined, true);
      if (!finalSchema.valid) {
        finalSchema.problems.forEach((problem) => out(`SCHEMA_DRIFT ${problem}`));
        out("Migration history was written, but schema validation failed; stop and inspect the database before retrying.");
        return 1;
      }
      out(result.applied.length === 0 ? "Nothing to apply." : `Applied: ${result.applied.join(", ")}`);
      out("Schema: valid");
      const after = await getStatus(db, migrations, undefined, { readOnly: true });
      out(`Pending: ${after.filter((row) => row.state === "pending").length}`);
      return 0;
    }

    if (command === "ready") {
      const result = await checkReadiness(db, migrations);
      out(result.ready ? "ready: the database answered a query and every migration is applied" : `not ready: ${result.reason}`);
      return result.ready ? 0 : 1;
    }
    const statuses = await getStatus(db, migrations, undefined, { readOnly: true });
    statuses.forEach((status) => out(`${status.version}_${status.name}  ${status.state}`));
    if (statuses.length === 0) out("No migrations.");
    const historyProblems = problemsOf(statuses);
    historyProblems.forEach((problem) => out(`PROBLEM ${problem}`));
    const applied = migrations.filter((migration) => statuses.some((row) => row.version === migration.version && row.state === "applied"));
    const schema = await validateMigrationSchema(db, applied, undefined, await trackingTableExists(db));
    schema.problems.forEach((problem) => out(`SCHEMA_DRIFT ${problem}`));
    return historyProblems.length || !schema.valid ? 1 : 0;
  } finally {
    await db.close();
  }
}

try {
  process.exitCode = await main(process.argv[2]);
} catch (error) {
  const safe = error instanceof ConfigError || error instanceof GuardError || error instanceof MigrationError || error instanceof DatabaseError || error instanceof DropPartialError || error instanceof ExternalDependencyError;
  process.stderr.write(`${safe ? error.message : "The command failed."}\n`);
  process.exitCode = 1;
}
