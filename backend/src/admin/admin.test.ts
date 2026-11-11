import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { hashPassword } from "../auth/password.ts";
import { COMPETITIONS } from "../db/seed/competitions.ts";
import { planSeed } from "../db/seed-events.ts";
import type { DatabaseAdapter, Dialect } from "../db/adapter.ts";
import { dialects, openTestDatabase } from "../db/test-db.ts";
import { dropAppSchema, installAppSchema } from "../db/test-schema.ts";
import { captureLogger, listen, testConfig } from "../test-helpers.ts";

// Dashboard and settings endpoints against a disposable database (in-memory SQLite always; a *_test MySQL database when configured).
// Nothing here touches rio_hospital: tests reach a database only through the guarded test helpers.

const ORIGIN = "http://admin.test";
const COST = { memoryKib: 1024, passes: 1 };
const TRACKING = "zz_admin_migrations";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Reply = { status: number; body: Json; text: string };
type Who = { cookie: string; csrf: string; id: number };

describe.each(dialects)("%s admin dashboard and settings", (dialect: Dialect) => {
  let db: DatabaseAdapter;
  let server: Server;
  let base: string;
  // Ahead of the real clock: the database trigger on results_publish_at compares with the real time.
  const clock = { t: Date.now() + 2 * DAY };
  const now = () => new Date(clock.t);
  const config = testConfig({ ALLOWED_ORIGINS: ORIGIN, TRUST_PROXY_HOPS: "1", ARGON2_MEMORY_KIB: String(COST.memoryKib), ARGON2_PASSES: String(COST.passes) });
  let counter = 0;
  const sql = <Row = Record<string, unknown>>(text: string, params: readonly (string | number | Date | null)[] = []) => db.query<Row>(text, params);

  beforeAll(async () => {
    db = openTestDatabase(dialect);
    await installAppSchema(db, TRACKING);
    server = createServer(createApp({ config, logger: captureLogger().logger, state: { shuttingDown: false }, db, now }));
    base = await listen(server);
    for (const c of COMPETITIONS) await sql("INSERT INTO events (slug, name_ta, name_en, min_age, max_age, display_order) VALUES (?, ?, ?, ?, ?, ?)", [c.slug, c.nameTa, c.nameEn, c.minAge, c.maxAge, c.number]);
  }, 120_000);
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await dropAppSchema(db, TRACKING);
    await db.close();
  });
  beforeEach(() => sql("UPDATE event_settings SET submissions_open_at = NULL, submissions_close_at = NULL, results_publish_at = NULL, guardian_consent_version = NULL, media_consent_version = NULL WHERE id = 1"));

  async function call(path: string, o: { method?: string; body?: unknown; who?: Who | null; csrf?: string | null; origin?: string | null } = {}): Promise<Reply> {
    const method = o.method ?? "GET";
    const headers: Record<string, string> = { "x-forwarded-for": `10.9.${++counter % 250}.${counter % 200}` };
    if (method !== "GET") headers["content-type"] = "application/json";
    if (o.origin !== null && method !== "GET") headers.origin = o.origin ?? ORIGIN;
    if (o.who) headers.cookie = o.who.cookie;
    const csrf = o.csrf === undefined ? o.who?.csrf : o.csrf;
    if (csrf) headers["x-csrf-token"] = csrf;
    const res = await fetch(base + path, { method, headers, ...(method !== "GET" ? { body: JSON.stringify(o.body ?? {}) } : {}) });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Json) : {}, text };
  }
  async function signIn(role: "admin" | "judge"): Promise<Who> {
    const email = `${role}${++counter}@example.org`;
    const password = `Start-Pass-${counter}-xyz`;
    await sql("INSERT INTO staff_users (email, password_hash, role, display_name, active, must_change_password, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)", [email, await hashPassword(password, COST), role, "Staff", now()]);
    const id = Number((await sql<{ id: number }>("SELECT id FROM staff_users WHERE email = ?", [email])).rows[0]!.id);
    const res = await fetch(`${base}/api/v1/staff/login`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": `10.8.${counter % 250}.${counter % 200}` }, body: JSON.stringify({ email, password }) });
    const body = (await res.json()) as Json;
    return { cookie: res.headers.getSetCookie()[0]!.split(";")[0]!, csrf: body.csrfToken as string, id };
  }
  const scalar = async (text: string, params: readonly (string | number | Date | null)[] = []) => Number((await sql<{ n: number }>(text, params)).rows[0]!.n);
  const iso = (offsetMs: number) => new Date(clock.t + offsetMs).toISOString();
  const patch = (who: Who | null, body: unknown, o: { csrf?: string | null; origin?: string | null } = {}) => call("/api/v1/admin/settings", { method: "PATCH", body, who, ...o });

  async function addEntry(slug: string, status: "draft" | "held" | "finalized", n: number) {
    const event = (await sql<{ id: number; min_age: number }>("SELECT id, min_age FROM events WHERE slug = ?", [slug])).rows[0]!;
    let setId = (await sql<{ id: number }>("SELECT id FROM question_sets WHERE event_id = ? AND status = 'published'", [event.id])).rows[0]?.id;
    if (setId === undefined) {
      await sql("INSERT INTO question_sets (event_id, version, status, created_at) VALUES (?, 1, 'draft', ?)", [event.id, now()]);
      setId = Number((await sql<{ id: number }>("SELECT id FROM question_sets WHERE event_id = ?", [event.id])).rows[0]!.id);
      await sql("UPDATE question_sets SET status = 'published', published_at = ? WHERE id = ?", [now(), setId]);
    }
    await sql(
      "INSERT INTO submissions (entry_code, event_id, question_set_id, status, child_name, child_name_norm, child_age, guardian_name, guardian_mobile, guardian_email, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)",
      [`RIO${String(n).padStart(5, "0")}`, event.id, Number(setId), "Secret Child", "secret child", event.min_age, "Secret Parent", "+919876543210", "secret@example.org", new Date(clock.t - n * 1000), new Date(clock.t - n * 1000)],
    );
    if (status === "draft") return;
    const id = Number((await sql<{ id: number }>("SELECT id FROM submissions WHERE entry_code = ?", [`RIO${String(n).padStart(5, "0")}`])).rows[0]!.id);
    await sql("INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at, verified_at, verified_bytes) VALUES (?, ?, 'video/mp4', 200000, 'verified', ?, ?, 200000)", [id, randomUUID(), new Date(clock.t + HOUR), now()]);
    await sql(`UPDATE submissions SET status = ?, guardian_consent_version = 'v1', guardian_consent_at = ?, submitted_at = ?${status === "finalized" ? ", finalized_at = ?" : ""} WHERE id = ?`,
      status === "finalized" ? [status, now(), now(), now(), id] : [status, now(), now(), id]);
  }

  describe("access control", () => {
    it("refuses anonymous callers on every route (401)", async () => {
      expect((await call("/api/v1/admin/dashboard")).status).toBe(401);
      expect((await call("/api/v1/admin/settings")).status).toBe(401);
      expect((await patch(null, { guardianConsentVersion: "v1" })).status).toBe(401);
    });
    it("refuses a judge on every route (403) and a judge cannot change settings", async () => {
      const judge = await signIn("judge");
      expect((await call("/api/v1/admin/dashboard", { who: judge })).status).toBe(403);
      expect((await call("/api/v1/admin/settings", { who: judge })).status).toBe(403);
      expect((await patch(judge, { guardianConsentVersion: "v1" })).status).toBe(403);
      expect(await scalar("SELECT COUNT(*) AS n FROM event_settings WHERE guardian_consent_version IS NOT NULL")).toBe(0);
    });
    it("refuses a change without the CSRF token or from another origin", async () => {
      const admin = await signIn("admin");
      expect((await patch(admin, { guardianConsentVersion: "v1" }, { csrf: null })).status).toBe(403);
      expect((await patch(admin, { guardianConsentVersion: "v1" }, { csrf: "wrong" })).status).toBe(403);
      expect((await patch(admin, { guardianConsentVersion: "v1" }, { origin: "http://evil.test" })).status).toBe(403);
      expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'settings.update'")).toBe(0);
    });
  });

  describe("GET /api/v1/admin/dashboard", () => {
    it("shows the six seeded competitions and zero everywhere else on an empty database", async () => {
      const admin = await signIn("admin");
      await sql("UPDATE staff_users SET active = 0 WHERE role = 'judge'");
      const { status, body } = await call("/api/v1/admin/dashboard", { who: admin });
      expect(status).toBe(200);
      expect(body.competitions).toEqual({ total: 6, active: 6 });
      expect(body.registrations).toEqual({ total: 0, draft: 0, finalized: 0, held: 0, withdrawn: 0, rejected: 0 });
      expect(body.judges).toEqual({ active: 0 });
      expect(body.recent).toEqual([]);
      expect(body.registration).toEqual({ open: false, opensAt: null, closesAt: null });
      const plan = await planSeed(db);
      expect(plan.toCreate).toEqual([]);
    });
    it("counts real rows, never exposes personal data, and counts only active judges", async () => {
      const admin = await signIn("admin");
      await sql("UPDATE staff_users SET active = 0 WHERE role = 'judge'");
      const slug = COMPETITIONS[0]!.slug;
      await addEntry(slug, "draft", 1);
      await addEntry(slug, "draft", 2);
      await addEntry(slug, "held", 3);
      await addEntry(COMPETITIONS[1]!.slug, "finalized", 4);
      const activeJudge = await signIn("judge");
      const inactive = await signIn("judge");
      await sql("UPDATE staff_users SET active = 0 WHERE id = ?", [inactive.id]);
      const { body, text } = await call("/api/v1/admin/dashboard", { who: admin });
      expect(body.registrations).toEqual({ total: 4, draft: 2, finalized: 1, held: 1, withdrawn: 0, rejected: 0 });
      expect(body.judges).toEqual({ active: 1 });
      expect(activeJudge.id).toBeGreaterThan(0);
      expect(body.recent.map((r: Json) => r.entryCode)).toEqual(["RIO00001", "RIO00002", "RIO00003", "RIO00004"]);
      expect(Object.keys(body.recent[0]).sort()).toEqual(["competitionNameEn", "competitionNameTa", "competitionSlug", "createdAt", "entryCode", "status", "updatedAt"]);
      expect(text).not.toMatch(/Secret|secret@|9876543210/);
    });
  });

  describe("GET and PATCH /api/v1/admin/settings", () => {
    it("reads the closed default", async () => {
      const admin = await signIn("admin");
      const { status, body } = await call("/api/v1/admin/settings", { who: admin });
      expect(status).toBe(200);
      expect(body).toMatchObject({ timezone: "Asia/Kolkata", registrationOpen: false, opensAt: null, closesAt: null, resultsPublishAt: null, guardianConsentVersion: null, resultsPublished: false });
    });
    it("saves a future window, consent version and results time, and writes one audit row without personal data", async () => {
      const admin = await signIn("admin");
      const input = { opensAt: "2026-12-01T09:00:00+05:30", closesAt: "2026-12-20T18:00:00+05:30", resultsPublishAt: "2026-12-30T10:00:00+05:30", guardianConsentVersion: "v1" };
      const { status, body } = await patch(admin, input);
      expect(status).toBe(200);
      expect(body).toMatchObject({ registrationOpen: false, opensAt: "2026-12-01T03:30:00.000Z", closesAt: "2026-12-20T12:30:00.000Z", resultsPublishAt: "2026-12-30T04:30:00.000Z", guardianConsentVersion: "v1" });
      expect((await call("/api/v1/admin/settings", { who: admin })).body.opensAt).toBe("2026-12-01T03:30:00.000Z");
      const rows = (await sql<{ details: unknown; actor_staff_id: number; entity_type: string }>("SELECT details, actor_staff_id, entity_type FROM audit_log WHERE action = 'settings.update'")).rows;
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.actor_staff_id)).toBe(admin.id);
      const details = typeof rows[0]!.details === "string" ? JSON.parse(rows[0]!.details) : rows[0]!.details;
      expect(details).toMatchObject({ guardianConsentVersion: "v1", closesAt: "2026-12-20T12:30:00.000Z" });
      expect(Number(await scalar("SELECT updated_by AS n FROM event_settings WHERE id = 1"))).toBe(admin.id);
    });
    it("does not audit a request that changes nothing", async () => {
      const admin = await signIn("admin");
      const before = await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'settings.update'");
      await patch(admin, { opensAt: null });
      expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'settings.update'")).toBe(before);
    });
    it("refuses an opening time in the past and writes nothing", async () => {
      const admin = await signIn("admin");
      const reply = await patch(admin, { opensAt: iso(-HOUR), closesAt: iso(DAY), guardianConsentVersion: "v1" });
      expect(reply.status).toBe(422);
      expect(reply.body.error.fields.opensAt).toBe("opens_in_past");
      expect(await scalar("SELECT COUNT(*) AS n FROM event_settings WHERE submissions_open_at IS NOT NULL")).toBe(0);
      expect((await call("/api/v1/admin/settings", { who: admin })).body.registrationOpen).toBe(false);
    });
    it("refuses a flag for opening: registrationOpen and registrationEnabled are not settings", async () => {
      const admin = await signIn("admin");
      expect((await patch(admin, { registrationOpen: true })).status).toBe(400);
      expect((await patch(admin, { registrationEnabled: true })).status).toBe(400);
      expect((await patch(admin, { registration_enabled: true })).status).toBe(400);
      expect((await call("/api/v1/admin/settings", { who: admin })).body.registrationOpen).toBe(false);
    });
    it.each([
      ["closing before opening", { opensAt: iso(2 * DAY), closesAt: iso(DAY), guardianConsentVersion: "v1" }, "closesAt", "close_before_open"],
      ["closing equal to opening", { opensAt: iso(DAY), closesAt: iso(DAY), guardianConsentVersion: "v1" }, "closesAt", "close_before_open"],
      ["opening without closing", { opensAt: iso(DAY), guardianConsentVersion: "v1" }, "closesAt", "window_needs_both"],
      ["closing without opening", { closesAt: iso(DAY) }, "opensAt", "window_needs_both"],
      ["opening without a consent version", { opensAt: iso(DAY), closesAt: iso(2 * DAY) }, "guardianConsentVersion", "consent_version_required"],
      ["results before the close", { opensAt: iso(DAY), closesAt: iso(3 * DAY), resultsPublishAt: iso(2 * DAY), guardianConsentVersion: "v1" }, "resultsPublishAt", "results_before_close"],
      ["results with no window", { resultsPublishAt: iso(5 * DAY) }, "resultsPublishAt", "results_need_close"],
      ["results in the past", { opensAt: iso(-3 * DAY), closesAt: iso(-2 * DAY), resultsPublishAt: iso(-HOUR), guardianConsentVersion: "v1" }, "resultsPublishAt", "results_in_past"],
    ])("rejects %s with a field code", async (_name, body, field, code) => {
      const admin = await signIn("admin");
      const reply = await patch(admin, body);
      expect(reply.status).toBe(422);
      expect(reply.body.error.code).toBe("invalid_settings");
      expect(reply.body.error.fields[field]).toBe(code);
      expect(await scalar("SELECT COUNT(*) AS n FROM event_settings WHERE submissions_open_at IS NOT NULL OR results_publish_at IS NOT NULL")).toBe(0);
    });
    it.each([
      ["an empty body", {}],
      ["a date without an offset", { opensAt: "2026-12-01T09:00:00" }],
      ["a date that is not a date", { opensAt: "tomorrow" }],
      ["an impossible date", { opensAt: "2026-02-31T09:00:00+05:30" }],
      ["a consent version with spaces", { guardianConsentVersion: "made up wording" }],
      ["an over-long consent version", { guardianConsentVersion: "v".repeat(41) }],
      ["an empty consent version", { guardianConsentVersion: "" }],
      ["an unknown field", { role: "admin" }],
      ["a number as a date", { opensAt: 1_800_000_000_000 }],
    ])("rejects %s with 400", async (_name, body) => {
      const admin = await signIn("admin");
      expect((await patch(admin, body)).status).toBe(400);
    });
    it("clears the window to disable registration, and refuses to clear the close while results are scheduled", async () => {
      const admin = await signIn("admin");
      await patch(admin, { opensAt: iso(DAY), closesAt: iso(3 * DAY), resultsPublishAt: iso(5 * DAY), guardianConsentVersion: "v1" });
      const blocked = await patch(admin, { opensAt: null, closesAt: null });
      expect(blocked.status).toBe(422);
      expect(blocked.body.error.fields.resultsPublishAt).toBe("results_need_close");
      const cleared = await patch(admin, { opensAt: null, closesAt: null, resultsPublishAt: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body).toMatchObject({ registrationOpen: false, opensAt: null, closesAt: null, resultsPublishAt: null });
    });
    it("never reschedules results that are already published", async () => {
      const publishedAt = new Date("2026-11-14T00:00:00.000Z");
      const originalClock = clock.t;
      // (the first session would be idle here)
      await sql("UPDATE event_settings SET submissions_open_at = ?, submissions_close_at = ?, guardian_consent_version = 'v1' WHERE id = 1", [new Date(publishedAt.getTime() - 10 * DAY), new Date(publishedAt.getTime() - 5 * DAY)]);
      // Written as a database fixture because the API (and the trigger) refuse a results time in the past.
      await sql("UPDATE event_settings SET results_publish_at = ? WHERE id = 1", [publishedAt]);
      clock.t = publishedAt.getTime() + HOUR;
      const later = await signIn("admin"); // the first session went idle while the clock moved
      const reply = await patch(later, { resultsPublishAt: iso(DAY) });
      clock.t = originalClock;
      expect(reply.status).toBe(409);
      expect(reply.body.error.code).toBe("results_already_published");
    });
    it("never publishes results by itself: a saved time is only a schedule", async () => {
      const admin = await signIn("admin");
      const { body } = await patch(admin, { opensAt: iso(DAY), closesAt: iso(2 * DAY), resultsPublishAt: iso(3 * DAY), guardianConsentVersion: "v1" });
      expect(body.resultsPublished).toBe(false);
      expect(body.registrationOpen).toBe(false);
    });
  });
});
