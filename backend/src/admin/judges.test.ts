import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { hashPassword } from "../auth/password.ts";
import { COMPETITIONS } from "../db/seed/competitions.ts";
import type { DatabaseAdapter, Dialect } from "../db/adapter.ts";
import { dialects, openTestDatabase } from "../db/test-db.ts";
import { dropAppSchema, installAppSchema } from "../db/test-schema.ts";
import type { VideoStore } from "../storage/r2.ts";
import { captureLogger, listen, testConfig } from "../test-helpers.ts";

const ORIGIN = "http://admin.test";
const COST = { memoryKib: 1024, passes: 1 };
const TRACKING = "zz_judges_migrations";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Reply = { status: number; body: Json; text: string };
type Who = { cookie: string; csrf: string; id: number };

describe.each(dialects)("%s judge management and judging portal", (dialect: Dialect) => {
  let db: DatabaseAdapter;
  let server: Server;
  let base: string;
  const clock = { t: Date.now() };
  const now = () => new Date(clock.t);
  const config = testConfig({
    ALLOWED_ORIGINS: ORIGIN,
    TRUST_PROXY_HOPS: "1",
    ARGON2_MEMORY_KIB: String(COST.memoryKib),
    ARGON2_PASSES: String(COST.passes),
  });
  let counter = 0;
  // A fake private bucket: it only signs a link for the key it is given.
  const fakeStore = { presignGet: async (key: string) => `https://bucket.test/${key}?sig=1` } as unknown as VideoStore;
  const sql = <Row = Record<string, unknown>>(text: string, params: readonly (string | number | Date | null)[] = []) =>
    db.query<Row>(text, params);

  beforeAll(async () => {
    db = openTestDatabase(dialect);
    await installAppSchema(db, TRACKING);
    server = createServer(createApp({ config, logger: captureLogger().logger, state: { shuttingDown: false }, db, now, video: fakeStore }));
    base = await listen(server);
    for (const c of COMPETITIONS) {
      await sql("INSERT INTO events (slug, name_ta, name_en, min_age, max_age, display_order) VALUES (?, ?, ?, ?, ?, ?)", [
        c.slug,
        c.nameTa,
        c.nameEn,
        c.minAge,
        c.maxAge,
        c.number,
      ]);
    }
  }, 120_000);

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await dropAppSchema(db, TRACKING);
    await db.close();
  });

  async function call(
    path: string,
    o: { method?: string; body?: unknown; who?: Who | null; csrf?: string | null; origin?: string | null } = {},
  ): Promise<Reply> {
    const method = o.method ?? "GET";
    const headers: Record<string, string> = { "x-forwarded-for": `10.9.${++counter % 250}.${counter % 200}` };
    if (method !== "GET") headers["content-type"] = "application/json";
    if (o.origin !== null && method !== "GET") headers.origin = o.origin ?? ORIGIN;
    if (o.who) headers.cookie = o.who.cookie;
    const csrf = o.csrf === undefined ? o.who?.csrf : o.csrf;
    if (csrf) headers["x-csrf-token"] = csrf;
    const res = await fetch(base + path, {
      method,
      headers,
      ...(method !== "GET" ? { body: JSON.stringify(o.body ?? {}) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Json) : {}, text };
  }

  async function signIn(role: "super_admin" | "admin" | "judge"): Promise<Who> {
    const email = `${role}${++counter}@example.org`;
    const password = `Start-Pass-${counter}-xyz`;
    await sql(
      "INSERT INTO staff_users (email, password_hash, role, display_name, active, must_change_password, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)",
      [email, await hashPassword(password, COST), role, "Staff", now()],
    );
    const id = Number((await sql<{ id: number }>("SELECT id FROM staff_users WHERE email = ?", [email])).rows[0]!.id);
    if (role === "judge") {
      await sql("INSERT INTO judge_profiles (user_id, role, judge_code, created_at) VALUES (?, 'judge', ?, ?)", [
        id,
        `JDG-T${counter}`,
        now(),
      ]);
    }
    const res = await fetch(`${base}/api/v1/staff/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": `10.8.${counter % 250}.${counter % 200}`,
      },
      body: JSON.stringify({ email, password }),
    });
    const body = (await res.json()) as Json;
    return { cookie: res.headers.getSetCookie()[0]!.split(";")[0]!, csrf: body.csrfToken as string, id };
  }

  it("only the Super Admin can add a judge; an admin can still list judges", async () => {
    const admin = await signIn("super_admin");
    const plain = await signIn("admin");
    const jud = await signIn("judge");
    for (const who of [plain, jud]) {
      expect((await call("/api/v1/admin/judges", { method: "POST", who, body: { email: `no${++counter}@riohospital.com`, displayName: "No" } })).status).toBe(403);
    }
    expect((await call("/api/v1/admin/judges", { who: plain })).status).toBe(200);
    const email = `newjudge${++counter}@riohospital.com`;
    const createRes = await call("/api/v1/admin/judges", {
      method: "POST",
      who: admin,
      body: { email, displayName: "Dr. Ananya" },
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.ok).toBe(true);
    expect(createRes.body.email).toBe(email);
    expect(createRes.body.generatedPassword).toMatch(/^[a-z0-9A-Z]{4}(-[a-z0-9A-Z]{4}){4}$/);

    const listRes = await call("/api/v1/admin/judges", { who: admin });
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.judges)).toBe(true);
    const found = listRes.body.judges.find((j: any) => j.email === email);
    expect(found).toBeDefined();
    expect(found.name).toBe("Dr. Ananya");
    expect(found.active).toBe(true);
  });

  it("admin can toggle judge active status and reset password", async () => {
    const admin = await signIn("super_admin");
    const email = `judge_to_toggle${++counter}@riohospital.com`;
    const createRes = await call("/api/v1/admin/judges", {
      method: "POST",
      who: admin,
      body: { email, displayName: "Judge Toggle" },
    });
    const judgeId = createRes.body.id;

    // Toggle inactive
    const deactivateRes = await call(`/api/v1/admin/judges/${judgeId}/active`, {
      method: "PATCH",
      who: admin,
      body: { active: false },
    });
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.ok).toBe(true);

    // Reset password
    const resetRes = await call(`/api/v1/admin/judges/${judgeId}/reset-password`, {
      method: "POST",
      who: admin,
    });
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.ok).toBe(true);
    expect(typeof resetRes.body.generatedPassword).toBe("string");
  });

  it("edit and soft delete: Super Admin only, duplicate email refused, history kept, login blocked", async () => {
    const boss = await signIn("super_admin");
    const admin = await signIn("admin");
    const mk = async (name: string) =>
      (await call("/api/v1/admin/judges", { method: "POST", who: boss, body: { email: `${name}${++counter}@riohospital.com`, displayName: name } })).body;
    const a = await mk("Alpha");
    const b = await mk("Bravo");

    const fresh = `new${++counter}@riohospital.com`;
    const edit = await call(`/api/v1/admin/judges/${a.id}`, { method: "PATCH", who: boss, body: { email: ` ${fresh.toUpperCase()} `, displayName: "  Alpha Two " } });
    expect(edit.status).toBe(200);
    const listed = (await call("/api/v1/admin/judges", { who: admin })).body.judges.find((j: Json) => j.id === a.id);
    expect(listed).toMatchObject({ name: "Alpha Two", email: fresh, judgeCode: a.judgeCode });

    expect((await call(`/api/v1/admin/judges/${a.id}`, { method: "PATCH", who: boss, body: { email: b.email, displayName: "X" } })).status).toBe(409);
    expect((await call(`/api/v1/admin/judges/${a.id}`, { method: "PATCH", who: boss, body: { email: "nope", displayName: "X" } })).status).toBe(400);
    expect((await call(`/api/v1/admin/judges/${a.id}`, { method: "PATCH", who: boss, body: { email: b.email, displayName: "X", role: "admin" } })).status).toBe(400);
    expect((await call(`/api/v1/admin/judges/${boss.id}`, { method: "PATCH", who: boss, body: { email: "x@y.zz", displayName: "X" } })).status).toBe(404);

    const judge = await signIn("judge");
    for (const who of [admin, judge]) {
      expect((await call(`/api/v1/admin/judges/${b.id}`, { method: "PATCH", who, body: { email: "q@y.zz", displayName: "Q" } })).status).toBe(403);
      expect((await call(`/api/v1/admin/judges/${b.id}`, { method: "DELETE", who })).status).toBe(403);
      expect((await call(`/api/v1/admin/judges/${b.id}/active`, { method: "PATCH", who, body: { active: false } })).status).toBe(403);
      expect((await call(`/api/v1/admin/judges/${b.id}/reset-password`, { method: "POST", who })).status).toBe(403);
    }

    // Soft delete the signed-in judge: session revoked, row and scores preserved, hidden from the roster, repeat is harmless.
    await sql("INSERT INTO judge_assignments (judge_id, submission_id, event_id, assigned_by, created_at) SELECT ?, id, event_id, ?, ? FROM submissions LIMIT 1", [judge.id, boss.id, now()]);
    expect((await call("/api/v1/judge/entries", { who: judge })).status).toBe(200);
    expect((await call(`/api/v1/admin/judges/${judge.id}`, { method: "DELETE", who: boss })).status).toBe(200);
    expect((await call("/api/v1/judge/entries", { who: judge })).status).toBe(401);
    expect((await call(`/api/v1/admin/judges/${judge.id}`, { method: "DELETE", who: boss })).status).toBe(200);
    expect((await call("/api/v1/admin/judges", { who: admin })).body.judges.some((j: Json) => j.id === judge.id)).toBe(false);
    expect(Number((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM staff_users WHERE id = ? AND deleted_at IS NOT NULL AND active = 0", [judge.id])).rows[0]!.n)).toBe(1);
    expect(Number((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'judge.delete' AND entity_id = ?", [String(judge.id)])).rows[0]!.n)).toBe(1);
    expect((await call(`/api/v1/admin/judges/${judge.id}/active`, { method: "PATCH", who: boss, body: { active: true } })).status).toBe(404);
  });

  it("reset password: new hash, sessions revoked, old password dead, new one must be changed at first sign-in, never exposed", async () => {
    const boss = await signIn("super_admin");
    const admin = await signIn("admin");
    const email = `reset${++counter}@riohospital.com`;
    const made = (await call("/api/v1/admin/judges", { method: "POST", who: boss, body: { email, displayName: "Reset Me" } })).body;
    const login = (password: string) =>
      fetch(`${base}/api/v1/staff/login`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": `10.7.${++counter % 250}.1` }, body: JSON.stringify({ email, password }) });
    const first = await login(made.generatedPassword);
    expect(first.status).toBe(200);
    const cookie = first.headers.getSetCookie()[0]!.split(";")[0]!;
    const hashBefore = (await sql<{ password_hash: string }>("SELECT password_hash FROM staff_users WHERE id = ?", [made.id])).rows[0]!.password_hash;

    expect((await call(`/api/v1/admin/judges/${made.id}/reset-password`, { method: "POST", who: admin })).status).toBe(403);
    const reset = await call(`/api/v1/admin/judges/${made.id}/reset-password`, { method: "POST", who: boss });
    expect(reset.status).toBe(200);
    expect(reset.text).not.toContain("password_hash");
    const fresh = reset.body.generatedPassword as string;
    expect(fresh).not.toBe(made.generatedPassword);

    const row = (await sql<{ password_hash: string; must_change_password: number }>("SELECT password_hash, must_change_password FROM staff_users WHERE id = ?", [made.id])).rows[0]!;
    expect(row.password_hash).not.toBe(hashBefore);
    expect(row.password_hash).not.toContain(fresh);
    expect(Number(row.must_change_password)).toBe(1);
    expect((await call("/api/v1/staff/me", { who: { cookie, csrf: "", id: made.id } })).status).toBe(401); // the old session is revoked
    expect((await login(made.generatedPassword)).status).toBe(401);
    const again = await login(fresh);
    expect(again.status).toBe(200);
    expect(((await again.json()) as Json).user.mustChangePassword).toBe(true);
    expect(Number((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'judge.reset_password' AND entity_id = ? AND details IS NULL", [String(made.id)])).rows[0]!.n)).toBe(1);
    expect((await call("/api/v1/admin/judges/999999/reset-password", { method: "POST", who: boss })).status).toBe(404);
  });

  it("deleted judges: Super Admin lists and restores them; purge works only for an account with no history", async () => {
    const boss = await signIn("super_admin");
    const admin = await signIn("admin");
    const active = await signIn("judge"); // signed in, so the audit log names this account
    const fresh = (await call("/api/v1/admin/judges", { method: "POST", who: boss, body: { email: `purge${++counter}@riohospital.com`, displayName: "Never Signed In" } })).body; // never signed in
    for (const id of [fresh.id, active.id]) expect((await call(`/api/v1/admin/judges/${id}`, { method: "DELETE", who: boss })).status).toBe(200);

    // the Deleted view
    const list = (await call("/api/v1/admin/judges/deleted", { who: boss })).body.judges as Json[];
    expect(list.map((j) => j.id)).toEqual(expect.arrayContaining([fresh.id, active.id]));
    expect(list[0]).not.toHaveProperty("passwordHash");
    expect((await call("/api/v1/admin/judges/deleted", { who: admin })).status).toBe(403);
    expect((await call("/api/v1/admin/judges/deleted", { who: null })).status).toBe(401);

    // restore: back on the roster, still switched off
    expect((await call(`/api/v1/admin/judges/${fresh.id}/restore`, { method: "POST", who: admin })).status).toBe(403);
    expect((await call(`/api/v1/admin/judges/${fresh.id}/restore`, { method: "POST", who: boss })).status).toBe(200);
    expect((await call(`/api/v1/admin/judges/${fresh.id}/restore`, { method: "POST", who: boss })).status).toBe(404); // no longer deleted
    const back = (await call("/api/v1/admin/judges", { who: boss })).body.judges.find((j: Json) => j.id === fresh.id);
    expect(back).toMatchObject({ active: false });

    // purge: not deleted -> 404; wrong role -> 403; history -> 409; clean -> gone
    expect((await call(`/api/v1/admin/judges/${fresh.id}/permanent`, { method: "DELETE", who: boss })).status).toBe(404);
    expect((await call(`/api/v1/admin/judges/${fresh.id}`, { method: "DELETE", who: boss })).status).toBe(200);
    expect((await call(`/api/v1/admin/judges/${fresh.id}/permanent`, { method: "DELETE", who: admin })).status).toBe(403);
    expect((await call(`/api/v1/admin/judges/${active.id}/permanent`, { method: "DELETE", who: boss })).status).toBe(409); // has recorded activity
    expect(Number((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM staff_users WHERE id = ?", [active.id])).rows[0]!.n)).toBe(1);
    expect((await call(`/api/v1/admin/judges/${fresh.id}/permanent`, { method: "DELETE", who: boss })).status).toBe(200);
    for (const table of ["staff_users WHERE id", "judge_profiles WHERE user_id", "staff_sessions WHERE staff_id"]) {
      expect(Number((await sql<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} = ?`, [fresh.id])).rows[0]!.n), table).toBe(0);
    }
    const audit = (await sql<{ details: unknown }>("SELECT details FROM audit_log WHERE action = 'judge.purged' AND entity_id = ?", [String(fresh.id)])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details ?? null).toBeNull(); // the id only: no name, no e-mail
    expect((await call(`/api/v1/admin/judges/${fresh.id}/permanent`, { method: "DELETE", who: boss })).status).toBe(404); // repeating is harmless
  });

  it("judge can view assigned entries and score 0 to 10", async () => {
    const admin = await signIn("admin");
    const judge = await signIn("judge");

    // A finalized entry with a checked video. The database requires the video BEFORE the entry can be finalized, so it is built in that order.
    const eventId = Number((await sql<{ id: number }>("SELECT id FROM events WHERE slug = 'malalai-mozhi'")).rows[0]!.id);
    const nextVersion = Number((await sql<{ v: number }>("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM question_sets WHERE event_id = ?", [eventId])).rows[0]!.v);
    await sql("INSERT INTO question_sets (event_id, version, status, created_at) VALUES (?, ?, 'draft', ?)", [eventId, nextVersion, now()]);
    const setId = Number((await sql<{ id: number }>("SELECT id FROM question_sets WHERE event_id = ? AND version = ?", [eventId, nextVersion])).rows[0]!.id);
    await sql("UPDATE question_sets SET status = 'published', published_at = ? WHERE id = ?", [now(), setId]);
    await sql(
      `INSERT INTO submissions (entry_code, event_id, question_set_id, status, child_name, child_name_norm, child_age, guardian_name, guardian_mobile, created_at, updated_at)
       VALUES ('JUDGE0001', ?, ?, 'draft', 'Arjun', 'arjun', 4, 'Meena', '+919876543210', ?, ?)`,
      [eventId, setId, now(), now()],
    );
    const subId = Number((await sql<{ id: number }>("SELECT id FROM submissions WHERE entry_code = 'JUDGE0001'")).rows[0]!.id);
    const entryCode = "JUDGE0001";
    await sql(
      `INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at, verified_at, verified_bytes)
       VALUES (?, '11111111-2222-4333-8444-555555555555', 'video/mp4', 1048576, 'verified', ?, ?, 1048576)`,
      [subId, new Date(now().getTime() + 3600_000), now()],
    );
    await sql("UPDATE submissions SET status = 'finalized', guardian_consent_version = 'v1', guardian_consent_at = ?, submitted_at = ?, finalized_at = ? WHERE id = ?", [now(), now(), now(), subId]);

    // Assign judge to the competition
    const assignRes = await call("/api/v1/admin/competitions/malalai-mozhi/assign-judge", {
      method: "POST",
      who: admin,
      body: { judgeId: judge.id },
    });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.ok).toBe(true);

    // Judge fetches assigned entries
    const entriesRes = await call("/api/v1/judge/entries", { who: judge });
    expect(entriesRes.status).toBe(200);
    const myEntry = entriesRes.body.entries.find((e: any) => e.entryCode === entryCode);
    expect(myEntry).toBeDefined();
    expect(myEntry.hasVideo).toBe(true);

    // Judge mints playback URL
    const playRes = await call(`/api/v1/judge/entries/${entryCode}/playback`, {
      method: "POST",
      who: judge,
    });
    expect(playRes.status).toBe(200);
    expect(playRes.body.ok).toBe(true);
    expect(typeof playRes.body.url).toBe("string");

    // Judge saves draft score (e.g. 8.5 out of 10)
    const draftRes = await call(`/api/v1/judge/entries/${entryCode}/score`, {
      method: "PUT",
      who: judge,
      body: { marks: 8.5, comments: "Great expressive Tamil poem!", final: false },
    });
    expect(draftRes.status).toBe(200);
    expect(draftRes.body.status).toBe("draft");
    expect(draftRes.body.marks).toBe(8.5);

    // Reject invalid marks (> 10)
    const invalidRes = await call(`/api/v1/judge/entries/${entryCode}/score`, {
      method: "PUT",
      who: judge,
      body: { marks: 11.0, final: false },
    });
    expect(invalidRes.status).toBe(400);

    // Submit final score
    const finalRes = await call(`/api/v1/judge/entries/${entryCode}/score`, {
      method: "PUT",
      who: judge,
      body: { marks: 9.0, comments: "Final evaluation", final: true },
    });
    expect(finalRes.status).toBe(200);
    expect(finalRes.body.status).toBe("final");
    expect(finalRes.body.marks).toBe(9.0);

    // Verify locked: cannot edit finalized score
    const lockedRes = await call(`/api/v1/judge/entries/${entryCode}/score`, {
      method: "PUT",
      who: judge,
      body: { marks: 9.5, comments: "Changed mind", final: true },
    });
    expect(lockedRes.status).toBe(403);
  });

  it("a judge sees and touches only their own assignments, and no admin route", async () => {
    // JUDGE0001 was assigned to another judge in the test above; this judge has nothing assigned.
    const stranger = await signIn("judge");
    expect((await call("/api/v1/judge/entries", { who: stranger })).body.entries).toEqual([]); // a real empty list, not an error
    expect((await call("/api/v1/judge/entries/JUDGE0001", { who: stranger })).status).toBe(404);
    expect((await call("/api/v1/judge/entries/JUDGE0001/playback", { method: "POST", who: stranger })).status).toBe(404);
    expect((await call("/api/v1/judge/entries/JUDGE0001/score", { method: "PUT", who: stranger, body: { marks: 5, final: false } })).status).toBe(404);
    expect(Number((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM scores WHERE judge_id = ?", [stranger.id])).rows[0]!.n)).toBe(0);
    for (const path of ["/api/v1/admin/dashboard", "/api/v1/admin/judges", "/api/v1/admin/registrations", "/api/v1/admin/settings", "/api/v1/admin/competitions", "/api/v1/admin/judges/deleted"]) {
      expect((await call(path, { who: stranger })).status, path).toBe(403);
    }
    expect((await call("/api/v1/judge/entries", { who: null })).status).toBe(401);
    // and an administrator is not a judge
    const admin = await signIn("admin");
    expect((await call("/api/v1/judge/entries", { who: admin })).status).toBe(403);
  });
});

