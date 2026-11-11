import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseAdapter, Dialect } from "./adapter.ts";
import { loadMigrations, migrate } from "./migrate.ts";
import { dialects, openTestDatabase } from "./test-db.ts";
import { dropAppSchema, migrationsDir } from "./test-schema.ts";

// Migration 0013 adds the role super_admin to staff_users. SQLite has to rebuild the table (it cannot change a CHECK); MySQL and MariaDB alter
// it in place. This test applies 0001 to 0012, fills the staff tables, applies 0013, and checks that nothing was lost or loosened.

const TRACKING = "zz_migration_0013";
const HOUR = 3_600_000;
const caught = async (work: Promise<unknown>): Promise<unknown> => work.then(() => undefined, (error: unknown) => error);

describe.each(dialects)("%s migration 0013 (super_admin role)", (dialect: Dialect) => {
  let db: DatabaseAdapter;
  const q = <Row = Record<string, unknown>>(sql: string, params: readonly (string | number | Date | null)[] = []) => db.query<Row>(sql, params);
  const scalar = async (sql: string, params: readonly (string | number | Date | null)[] = []) => Number((await q<{ n: number }>(sql, params)).rows[0]!.n);
  const user = (email: string, role: string) =>
    q("INSERT INTO staff_users (email, password_hash, role, display_name, must_change_password, created_at) VALUES (?, ?, ?, 'Name', 0, ?)", [email, "h".repeat(60), role, new Date()]);

  beforeAll(async () => {
    db = openTestDatabase(dialect);
    await dropAppSchema(db, TRACKING);
    const all = await loadMigrations(migrationsDir(dialect));
    expect(all.map((m) => m.version).slice(11, 13)).toEqual(["0012", "0013"]);
    await migrate(db, all.filter((m) => m.version <= "0012"), TRACKING);

    const now = new Date();
    await user("admin@example.org", "admin");
    await user("judge@example.org", "judge");
    await q("INSERT INTO judge_profiles (user_id, judge_code) VALUES (2, 'JUDGE-1')");
    await q("INSERT INTO staff_sessions (staff_id, token_sha256, expires_at, created_at) VALUES (1, ?, ?, ?)", ["a".repeat(64), new Date(now.getTime() + HOUR), now]);
    await q("INSERT INTO audit_log (actor_type, actor_staff_id, action, entity_type) VALUES ('staff', 1, 'staff.login', 'staff_user')");
    expect(await migrate(db, all.filter((m) => m.version <= "0013"), TRACKING)).toEqual({ applied: ["0013"] });
  }, 120_000);
  afterAll(async () => {
    await dropAppSchema(db, TRACKING);
    await db.close();
  });

  it("keeps every existing account, id and value", async () => {
    const rows = (await q<{ id: number; email: string; role: string; display_name: string; active: number }>("SELECT id, email, role, display_name, active FROM staff_users ORDER BY id")).rows;
    expect(rows.map((r) => [Number(r.id), r.email, r.role, r.display_name, Number(r.active)])).toEqual([
      [1, "admin@example.org", "admin", "Name", 1],
      [2, "judge@example.org", "judge", "Name", 1],
    ]);
  });

  it("accepts super_admin and still rejects any other role", async () => {
    await user("super@example.org", "super_admin");
    expect(await scalar("SELECT COUNT(*) AS n FROM staff_users WHERE role = 'super_admin'")).toBe(1);
    expect(await caught(user("root@example.org", "root"))).toMatchObject({ constraint: "check" });
    expect(await caught(user("empty@example.org", ""))).toMatchObject({ constraint: "check" });
  });

  it("keeps the e-mail key and the other checks", async () => {
    expect(await caught(user("admin@example.org", "admin"))).toMatchObject({ constraint: "unique" });
    expect(await caught(q("INSERT INTO staff_users (email, password_hash, role, display_name, created_at) VALUES ('Upper@Example.org', ?, 'admin', 'N', ?)", ["h".repeat(60), new Date()]))).toMatchObject({ constraint: "check" });
  });

  it("keeps the rows and foreign keys that point at staff_users", async () => {
    expect(await scalar("SELECT COUNT(*) AS n FROM judge_profiles")).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM staff_sessions")).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log")).toBe(1);
    expect(await caught(q("INSERT INTO staff_sessions (staff_id, token_sha256, expires_at, created_at) VALUES (999999, ?, ?, ?)", ["b".repeat(64), new Date(Date.now() + HOUR), new Date()]))).toMatchObject({ constraint: "foreign_key" });
    expect(await caught(q("DELETE FROM staff_users WHERE id = 1"))).toMatchObject({ constraint: "foreign_key" });
  });

  it("still ties judge_profiles to a JUDGE (the UNIQUE (id, role) key and its foreign key survive)", async () => {
    expect(await caught(q("INSERT INTO judge_profiles (user_id, judge_code) VALUES (1, 'ADMIN-1')"))).toMatchObject({ constraint: "foreign_key" }); // an administrator
    const superId = Number((await q<{ id: number }>("SELECT id FROM staff_users WHERE email = 'super@example.org'")).rows[0]!.id);
    expect(await caught(q("INSERT INTO judge_profiles (user_id, judge_code) VALUES (?, 'SUPER-1')", [superId]))).toMatchObject({ constraint: "foreign_key" }); // a super admin
  });

  it("is recorded once and a second run changes nothing", async () => {
    const all = await loadMigrations(migrationsDir(dialect));
    expect(await migrate(db, all, TRACKING)).toEqual({ applied: [] });
  });
});
