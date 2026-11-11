import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import type { DatabaseAdapter, Dialect } from "../db/adapter.ts";
import { dialects, openTestDatabase } from "../db/test-db.ts";
import { dropAppSchema, installAppSchema } from "../db/test-schema.ts";
import { AppError } from "../http/errors.ts";
import { captureLogger, listen, testConfig } from "../test-helpers.ts";
import { runStaffCli } from "./cli-core.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { isStaffRole, ROLES } from "./roles.ts";
import { authDeps, resetPassword, seedSuperAdmin } from "./staff.ts";

// The Super Admin role: what it may use, what an ordinary administrator may not, and the seed command. Cheap Argon2 settings keep it fast.

const ORIGIN = "http://admin.test";
const COST = { memoryKib: 1024, passes: 1 };
const TRACKING = "zz_super_admin_migrations";
const SEED_PASSWORD = "Seed-Pass-for-tests-9";

describe("roles", () => {
  it("knows exactly three roles and lists permissions by name, with no wildcard", () => {
    expect(["super_admin", "admin", "judge", "root", "", undefined].map(isStaffRole)).toEqual([true, true, true, false, false, false]);
    expect(ROLES.adminApi).toEqual(["super_admin", "admin"]);
    expect(ROLES.superAdminOnly).toEqual(["super_admin"]);
    expect(ROLES.judgeApi).toEqual(["judge"]);
  });
});

describe.each(dialects)("%s Super Admin", (dialect: Dialect) => {
  let db: DatabaseAdapter;
  let server: Server;
  let base: string;
  const config = testConfig({ ALLOWED_ORIGINS: ORIGIN, TRUST_PROXY_HOPS: "1", ARGON2_MEMORY_KIB: String(COST.memoryKib), ARGON2_PASSES: String(COST.passes) });
  const deps = () => authDeps(db, config.auth);
  let n = 0;

  beforeAll(async () => {
    db = openTestDatabase(dialect);
    await installAppSchema(db, TRACKING);
    server = createServer(createApp({ config, logger: captureLogger().logger, state: { shuttingDown: false }, db }));
    base = await listen(server);
  }, 120_000);
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await dropAppSchema(db, TRACKING);
    await db.close();
  });

  const sql = <Row = Record<string, unknown>>(text: string, params: readonly (string | number | Date | null)[] = []) => db.query<Row>(text, params);
  const scalar = async (text: string, params: readonly (string | number | Date | null)[] = []) => Number((await sql<{ n: number }>(text, params)).rows[0]!.n);

  async function account(role: "super_admin" | "admin" | "judge") {
    const email = `${role.replace("_", "")}${++n}@example.org`;
    const password = `Start-Pass-${n}-xyz`;
    await sql("INSERT INTO staff_users (email, password_hash, role, display_name, active, must_change_password, created_at) VALUES (?, ?, ?, 'Name', 1, 0, ?)", [email, await hashPassword(password, COST), role, new Date()]);
    return { email, password, id: Number((await sql<{ id: number }>("SELECT id FROM staff_users WHERE email = ?", [email])).rows[0]!.id) };
  }
  async function signIn(a: { email: string; password: string }) {
    const res = await fetch(`${base}/api/v1/staff/login`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": `10.1.${++n % 250}.${(n * 7) % 250}` }, body: JSON.stringify({ email: a.email, password: a.password }) });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("rio_staff="))?.split(";")[0] ?? null;
    return { status: res.status, cookie, body: (await res.json()) as { user?: { role: string } } };
  }
  const get = async (path: string, cookie: string | null) => (await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} })).status;

  it("signs a Super Admin in and returns the role; existing admin and judge sign-in is unchanged", async () => {
    for (const role of ["super_admin", "admin", "judge"] as const) {
      const reply = await signIn(await account(role));
      expect([reply.status, reply.body.user?.role, reply.cookie !== null]).toEqual([200, role, true]);
    }
  });

  it("authorises by explicit role: admin API for super_admin and admin, staff management for super_admin only, nothing for judge", async () => {
    const superAdmin = await signIn(await account("super_admin"));
    const admin = await signIn(await account("admin"));
    const judge = await signIn(await account("judge"));
    expect([await get("/api/v1/admin/dashboard", superAdmin.cookie), await get("/api/v1/admin/dashboard", admin.cookie), await get("/api/v1/admin/dashboard", judge.cookie), await get("/api/v1/admin/dashboard", null)]).toEqual([200, 200, 403, 401]);
    expect([await get("/api/v1/admin/staff", superAdmin.cookie), await get("/api/v1/admin/staff", admin.cookie), await get("/api/v1/admin/staff", judge.cookie), await get("/api/v1/admin/staff", null)]).toEqual([200, 403, 403, 401]);
  });

  it("lists staff without any password material", async () => {
    const reply = await fetch(`${base}/api/v1/admin/staff`, { headers: { cookie: (await signIn(await account("super_admin"))).cookie! } });
    const text = await reply.text();
    expect(text).not.toMatch(/password|hash|argon/i);
    expect(JSON.parse(text).staff.length).toBeGreaterThan(0);
  });

  it("rejects an unknown role at the database", async () => {
    await expect(sql("INSERT INTO staff_users (email, password_hash, role, display_name, created_at) VALUES ('x@example.org', ?, 'root', 'X', ?)", ["h".repeat(40), new Date()])).rejects.toMatchObject({ constraint: "check" });
  });

  describe("seed", () => {
    it("creates the account once with an Argon2id hash, never resets it, and writes one audit row", async () => {
      const first = await seedSuperAdmin(deps(), { email: "riosuperadmin@gmail.com", displayName: "Rio Super Admin", password: SEED_PASSWORD });
      expect(first).toEqual({ created: true });
      const row = (await sql<{ role: string; password_hash: string; must_change_password: number; active: number }>("SELECT role, password_hash, must_change_password, active FROM staff_users WHERE email = 'riosuperadmin@gmail.com'")).rows[0]!;
      expect(row).toMatchObject({ role: "super_admin", must_change_password: 1, active: 1 });
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
      expect(row.password_hash).not.toContain(SEED_PASSWORD);
      expect(await verifyPassword(SEED_PASSWORD, row.password_hash)).toBe(true);

      const again = await seedSuperAdmin(deps(), { email: "riosuperadmin@gmail.com", displayName: "Someone Else", password: "A-completely-Different-1" });
      expect(again).toEqual({ created: false });
      const after = (await sql<{ password_hash: string; display_name: string }>("SELECT password_hash, display_name FROM staff_users WHERE email = 'riosuperadmin@gmail.com'")).rows[0]!;
      expect(after).toEqual({ password_hash: row.password_hash, display_name: "Rio Super Admin" });
      expect(await scalar("SELECT COUNT(*) AS n FROM staff_users WHERE email = 'riosuperadmin@gmail.com'")).toBe(1);
      expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'staff.created' AND details LIKE '%super_admin%'")).toBe(1);
    });

    it("refuses an e-mail already used by another role, and a weak password, changing nothing", async () => {
      const admin = await account("admin");
      await expect(seedSuperAdmin(deps(), { email: admin.email, displayName: "X", password: SEED_PASSWORD })).rejects.toMatchObject({ code: "role_collision" });
      expect((await sql<{ role: string }>("SELECT role FROM staff_users WHERE id = ?", [admin.id])).rows[0]!.role).toBe("admin");
      await expect(seedSuperAdmin(deps(), { email: "weak@example.org", displayName: "X", password: "short" })).rejects.toMatchObject({ code: "weak_password" });
      expect(await scalar("SELECT COUNT(*) AS n FROM staff_users WHERE email = 'weak@example.org'")).toBe(0);
    });

    it("keeps existing staff accounts untouched", async () => {
      const before = await scalar("SELECT COUNT(*) AS n FROM staff_users WHERE role IN ('admin', 'judge')");
      await seedSuperAdmin(deps(), { email: "riosuperadmin@gmail.com", displayName: "Rio Super Admin", password: SEED_PASSWORD });
      expect(await scalar("SELECT COUNT(*) AS n FROM staff_users WHERE role IN ('admin', 'judge')")).toBe(before);
    });

    it("lets only a Super Admin (or the system) change a Super Admin account", async () => {
      const target = await account("super_admin");
      const admin = await account("admin");
      const other = await account("super_admin");
      await expect(resetPassword(deps(), { staffId: target.id, actor: { type: "staff", id: admin.id } })).rejects.toBeInstanceOf(AppError);
      await expect(resetPassword(deps(), { staffId: target.id, actor: { type: "staff", id: admin.id } })).rejects.toMatchObject({ status: 403 });
      await expect(resetPassword(deps(), { staffId: target.id, actor: { type: "staff", id: other.id } })).resolves.toHaveProperty("temporaryPassword");
      await expect(resetPassword(deps(), { staffId: admin.id, actor: { type: "staff", id: admin.id } })).resolves.toHaveProperty("temporaryPassword");
    });
  });

  describe("seed command", () => {
    const cheap = { ARGON2_MEMORY_KIB: "1024", ARGON2_PASSES: "1" };
    const env = (over: Record<string, string> = {}): Record<string, string | undefined> => ({ NODE_ENV: "test", DB_DIALECT: "sqlite", SQLITE_PATH: ":memory:", DB_ALLOWED_DATABASE: ":memory:", ...cheap, ...over });
    const run = async (e: Record<string, string | undefined>, ...argv: string[]) => {
      const out: string[] = [];
      const err: string[] = [];
      const shared = { query: db.query.bind(db), transaction: db.transaction.bind(db), dialect: db.dialect, close: async () => undefined } as unknown as DatabaseAdapter;
      const code = await runStaffCli(argv, { env: e, out: (l) => out.push(l), err: (l) => err.push(l) }, () => shared);
      return { code, text: [...out, ...err].join("\n") };
    };

    it("needs the password from RIO_SUPER_ADMIN_PASSWORD and prints no password", async () => {
      const missing = await run(env(), "seed-super-admin");
      expect(missing.code).toBe(2);
      expect(missing.text).toContain("RIO_SUPER_ADMIN_PASSWORD");
      const made = await run(env({ RIO_SUPER_ADMIN_PASSWORD: "Another-Strong-Pass-7" }), "seed-super-admin", "--email", "second.super@example.org");
      expect(made.code).toBe(0);
      expect(made.text).toContain("Super Admin created: second.super@example.org");
      expect(made.text).not.toContain("Another-Strong-Pass-7");
      const repeat = await run(env({ RIO_SUPER_ADMIN_PASSWORD: "Another-Strong-Pass-7" }), "seed-super-admin", "--email", "second.super@example.org");
      expect(repeat.text).toContain("already exists");
    });

    it("reports a weak password without echoing it", async () => {
      const weak = await run(env({ RIO_SUPER_ADMIN_PASSWORD: "short1" }), "seed-super-admin", "--email", "third.super@example.org");
      expect(weak.code).toBe(1);
      expect(weak.text).toContain("not acceptable");
      expect(weak.text).not.toContain("short1");
    });
  });
});
