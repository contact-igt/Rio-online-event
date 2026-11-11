import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "../config.ts";
import type { DatabaseAdapter } from "../db/adapter.ts";
import { DatabaseError } from "../db/errors.ts";
import { assertStaffCliAllowed, GuardError, requireDatabase } from "../db/guards.ts";
import { assertDatabaseName, assertEngineMatches } from "../db/engine.ts";
import { openDatabase } from "../db/open.ts";
import { AppError } from "../http/errors.ts";
import { authDeps, createAdmin, emailSchema, resetPassword, seedSuperAdmin, SUPER_ADMIN_DEFAULTS, WeakPassword } from "./staff.ts";

// npm run staff:create-admin -- --email you@example.org --name "Your Name" [--additional]
// npm run staff:reset-password -- --email someone@example.org
//
// The only way the first administrator comes into existence (there is no public registration). A random temporary password is generated,
// stored only as an Argon2id hash, and printed once to this terminal; it is never logged, put in the audit log or kept anywhere else, and
// the account must choose its own password at the first sign-in. Everything printed is a fixed sentence, the operator's own input, or that
// one password. DB_ALLOWED_DATABASE and the live connection identity must match before any account operation.

export type CliIo = { env: Record<string, string | undefined>; out: (line: string) => void; err: (line: string) => void };

const USAGE = 'Usage: staff:seed-super-admin [--email <address>] [--name "<name>"] | staff:create-admin --email <address> --name "<name>" [--additional] | staff:reset-password --email <address>';

export async function runStaffCli(argv: string[], io: CliIo, openDb: typeof openDatabase = openDatabase): Promise<number> {
  const [command, ...rest] = argv;
  let values: { email?: string | undefined; name?: string | undefined; additional?: boolean | undefined };
  try {
    ({ values } = parseArgs({ args: rest, options: { email: { type: "string" }, name: { type: "string" }, additional: { type: "boolean" } }, strict: true }));
  } catch {
    io.err(USAGE);
    return 2;
  }
  const seeding = command === "seed-super-admin";
  if (seeding) {
    values.email ??= SUPER_ADMIN_DEFAULTS.email;
    values.name ??= SUPER_ADMIN_DEFAULTS.displayName;
  }
  if ((command !== "create-admin" && command !== "reset-password" && !seeding) || values.email === undefined || (command === "create-admin" && values.name === undefined)) {
    io.err(USAGE);
    return 2;
  }
  const email = emailSchema.safeParse(values.email);
  if (!email.success) {
    io.err("The e-mail address is not valid.");
    return 2;
  }

  let db: DatabaseAdapter | undefined;
  try {
    const config = loadConfig(io.env);
    const database = requireDatabase(config);
    assertStaffCliAllowed(config, io.env);
    db = openDb(database);
    await assertDatabaseName(db, database);
    await assertEngineMatches(db, database);
    const deps = authDeps(db, config.auth);

    if (seeding) {
      // The password comes only from the environment of this one command, never from an argument (arguments show up in process lists and shell history).
      const password = io.env.RIO_SUPER_ADMIN_PASSWORD;
      if (!password) {
        io.err("Set RIO_SUPER_ADMIN_PASSWORD (a strong password of your choice) for this command. It is not printed or stored anywhere else.");
        return 2;
      }
      const { created } = await seedSuperAdmin(deps, { email: email.data, displayName: values.name!, password });
      io.out(created ? `Super Admin created: ${email.data}. They must choose a new password at the first sign-in.` : `Super Admin already exists: ${email.data}. Nothing was changed.`);
      return 0;
    }
    if (command === "create-admin") {
      const existing = Number((await db.query<{ n: number | string }>("SELECT COUNT(*) AS n FROM staff_users WHERE role = 'admin' AND active = 1")).rows[0]?.n ?? 0);
      if (existing > 0 && !values.additional) {
        io.err("An active administrator already exists. Use --additional only if you really mean to add another one.");
        return 1;
      }
      const created = await createAdmin(deps, { email: email.data, displayName: values.name!, actor: { type: "system" } });
      io.out(`Administrator created: ${email.data}`);
      io.out(`Temporary password (shown once): ${created.temporaryPassword}`);
      io.out("They must choose a new password at the first sign-in.");
      return 0;
    }

    const found = (await db.query<{ id: number | string }>("SELECT id FROM staff_users WHERE email = ?", [email.data])).rows[0];
    if (!found) {
      io.err("No staff account has that e-mail address.");
      return 1;
    }
    const reset = await resetPassword(deps, { staffId: Number(found.id), actor: { type: "system" } });
    io.out(`Password reset for: ${email.data}. All their sessions were ended.`);
    io.out(`Temporary password (shown once): ${reset.temporaryPassword}`);
    io.out("They must choose a new password at the next sign-in.");
    return 0;
  } catch (error) {
    // Only types with fixed, value-free messages are printed.
    if (error instanceof WeakPassword) {
      io.err(`The password is not acceptable: ${error.problems.join(", ")}.`);
      return 1;
    }
    const safe = error instanceof ConfigError || error instanceof GuardError || error instanceof AppError || error instanceof DatabaseError;
    io.err(safe ? error.message : "The command failed.");
    return 1;
  } finally {
    await db?.close();
  }
}
