import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { hashPassword } from "../auth/password.ts";
import type { DatabaseAdapter, Dialect } from "../db/adapter.ts";
import { dialects, openTestDatabase } from "../db/test-db.ts";
import { dropAppSchema, installAppSchema } from "../db/test-schema.ts";
import { captureLogger, listen, testConfig } from "../test-helpers.ts";

// The administrator's Scoring screens through the real API and database: averages of FINAL marks only, a rank only once every assigned
// judge has finalized, ties flagged (never broken), held entries counted but not ranked, and judges or anonymous callers refused.

const ORIGIN = "http://admin.test";
const COST = { memoryKib: 1024, passes: 1 };
const TRACKING = "zz_scoring_migrations";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { cookie: string; csrf: string; id: number };

describe.each(dialects)("%s admin scoring", (dialect: Dialect) => {
  let db: DatabaseAdapter;
  let server: Server;
  let base: string;
  let counter = 0;
  const clock = { t: null as number | null };
  const now = () => (clock.t === null ? new Date() : new Date(clock.t));
  const config = testConfig({ ALLOWED_ORIGINS: ORIGIN, TRUST_PROXY_HOPS: "1", ARGON2_MEMORY_KIB: String(COST.memoryKib), ARGON2_PASSES: String(COST.passes) });
  const sql = <Row = Record<string, unknown>>(text: string, params: readonly (string | number | Date | null)[] = []) => db.query<Row>(text, params);
  let eventId = 0;
  let setId = 0;

  beforeAll(async () => {
    db = openTestDatabase(dialect);
    await installAppSchema(db, TRACKING);
    server = createServer(createApp({ config, logger: captureLogger().logger, state: { shuttingDown: false }, db, now, video: null }));
    base = await listen(server);
    await sql("INSERT INTO events (slug, name_ta, name_en, min_age, max_age, display_order) VALUES ('kathai', 'கதை', 'Stories', 3, 12, 1)");
    await sql("INSERT INTO events (slug, name_ta, name_en, min_age, max_age, display_order) VALUES ('empty-one', 'வெற்று', 'Empty', 3, 12, 2)");
    eventId = Number((await sql<{ id: number }>("SELECT id FROM events WHERE slug = 'kathai'")).rows[0]!.id);
    await sql("INSERT INTO question_sets (event_id, version) VALUES (?, 1)", [eventId]);
    setId = Number((await sql<{ id: number }>("SELECT id FROM question_sets WHERE event_id = ?", [eventId])).rows[0]!.id);
    await sql("UPDATE question_sets SET status = 'published', published_at = ? WHERE id = ?", [now(), setId]);
  }, 120_000);
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await dropAppSchema(db, TRACKING);
    await db.close();
  });

  async function call(path: string, o: { method?: string; body?: unknown; who?: Who | null } = {}) {
    const method = o.method ?? "GET";
    const headers: Record<string, string> = { "x-forwarded-for": `10.5.${++counter % 250}.${counter % 200}` };
    if (method !== "GET") {
      headers["content-type"] = "application/json";
      headers.origin = ORIGIN;
    }
    if (o.who) {
      headers.cookie = o.who.cookie;
      headers["x-csrf-token"] = o.who.csrf;
    }
    const res = await fetch(base + path, { method, headers, ...(method !== "GET" ? { body: JSON.stringify(o.body ?? {}) } : {}) });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as Json, text };
  }
  async function signIn(role: "admin" | "judge", name = "Staff"): Promise<Who> {
    const email = `${role}${++counter}@example.org`;
    const password = `Start-Pass-${counter}-xyz`;
    await sql("INSERT INTO staff_users (email, password_hash, role, display_name, active, must_change_password, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)", [email, await hashPassword(password, COST), role, name, now()]);
    const id = Number((await sql<{ id: number }>("SELECT id FROM staff_users WHERE email = ?", [email])).rows[0]!.id);
    if (role === "judge") await sql("INSERT INTO judge_profiles (user_id, role, judge_code, created_at) VALUES (?, 'judge', ?, ?)", [id, `JDG-S${counter}`, now()]);
    const res = await fetch(`${base}/api/v1/staff/login`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": `10.6.${counter % 250}.${counter % 200}` }, body: JSON.stringify({ email, password }) });
    const body = (await res.json()) as Json;
    return { cookie: res.headers.getSetCookie()[0]!.split(";")[0]!, csrf: body.csrfToken as string, id };
  }
  /** A submitted entry, built the way the database allows: a draft, a checked video, then finalized (or held). */
  async function entry(code: string, child: string, status: "finalized" | "held" = "finalized") {
    await sql(
      `INSERT INTO submissions (entry_code, event_id, question_set_id, child_name, child_name_norm, child_age, guardian_name, guardian_mobile, guardian_consent_version, guardian_consent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 6, 'Parent', ?, 'v1', ?, ?, ?)`,
      [code, eventId, setId, child, child.toLowerCase(), `+9198765${String(++counter).padStart(5, "0")}`, now(), now(), now()],
    );
    const id = Number((await sql<{ id: number }>("SELECT id FROM submissions WHERE entry_code = ?", [code])).rows[0]!.id);
    await sql("INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at, verified_at, verified_bytes) VALUES (?, ?, 'video/mp4', 200000, 'verified', ?, ?, 200000)", [
      id, `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`, new Date(Date.now() + 3_600_000), now(),
    ]);
    await sql(`UPDATE submissions SET status = ?, submitted_at = ?${status === "finalized" ? ", finalized_at = ?" : ""} WHERE id = ?`, status === "finalized" ? [status, now(), now(), id] : [status, now(), id]);
  }
  const score = (judge: Who, code: string, marks: number, final: boolean) => call(`/api/v1/judge/entries/${code}/score`, { method: "PUT", who: judge, body: { marks, final } });

  it("ranks by the average of final marks, flags a tie, keeps unfinished entries unranked, and refuses anyone but an administrator", async () => {
    const admin = await signIn("admin");
    const anu = await signIn("judge", "Anu");
    const ravi = await signIn("judge", "Ravi");
    await entry("RIOSCOREA1", "Asha"); // 9 and 8 -> 8.5
    await entry("RIOSCOREB2", "Bala"); // 8.5 and 8.5 -> 8.5: a tie with A
    await entry("RIOSCOREC3", "Chitra"); // 10 and 9 -> 9.5: first
    await entry("RIOSCORED4", "Divya"); // Ravi only drafts -> not ranked yet
    await entry("RIOSCOREE5", "Eswar", "held"); // possible duplicate: counted, not ranked
    for (const j of [anu, ravi]) expect((await call("/api/v1/admin/competitions/kathai/assign-judge", { method: "POST", who: admin, body: { judgeId: j.id } })).status).toBe(200);

    for (const [code, a, r] of [["RIOSCOREA1", 9, 8], ["RIOSCOREB2", 8.5, 8.5], ["RIOSCOREC3", 10, 9]] as const) {
      expect((await score(anu, code, a, true)).status).toBe(200);
      expect((await score(ravi, code, r, true)).status).toBe(200);
    }
    expect((await score(anu, "RIOSCORED4", 7, true)).status).toBe(200);
    expect((await score(ravi, "RIOSCORED4", 9.75, false)).status).toBe(200); // a draft never counts

    const r = await call("/api/v1/admin/competitions/kathai/ranking", { who: admin });
    expect(r.status, r.text).toBe(200);
    expect(r.body.competition).toMatchObject({ slug: "kathai", nameEn: "Stories" });
    const rows = r.body.entries as Json[];
    expect(rows.map((x) => [x.entryCode, x.rank, x.average, x.tie, x.complete])).toEqual([
      ["RIOSCOREC3", 1, 9.5, false, true],
      ["RIOSCOREA1", 2, 8.5, true, true],
      ["RIOSCOREB2", 2, 8.5, true, true],
      ["RIOSCORED4", null, 7, false, false],
    ]);
    expect(rows[0]).toMatchObject({ childName: "Chitra", childAge: 6, hasVideo: true, assigned: 2, finalScores: 2, drafts: 0 });
    expect(rows[3]).toMatchObject({ assigned: 2, finalScores: 1, drafts: 1 });
    expect(rows[3]!.judges).toEqual(expect.arrayContaining([
      expect.objectContaining({ judgeName: "Anu", marks: 7, status: "final" }),
      expect.objectContaining({ judgeName: "Ravi", marks: 9.75, status: "draft" }),
    ]));
    expect(r.body.summary).toEqual({ submitted: 4, ranked: 3, waiting: 1, notAssigned: 0, ties: 2, heldForReview: 1 });
    expect(r.text).not.toMatch(/9876|Parent|guardian/i); // no contact details on the scoring screen

    const overview = await call("/api/v1/admin/scoring", { who: admin });
    expect(overview.status).toBe(200);
    expect(overview.body.competitions).toEqual([
      expect.objectContaining({ slug: "kathai", submitted: 4, ranked: 3, waiting: 1, ties: 2, heldForReview: 1 }),
      expect.objectContaining({ slug: "empty-one", submitted: 0, ranked: 0, waiting: 0, notAssigned: 0, ties: 0, heldForReview: 0 }),
    ]);

    // a judge, a signed-out caller and an unknown competition
    expect((await call("/api/v1/admin/competitions/kathai/ranking", { who: anu })).status).toBe(403);
    expect((await call("/api/v1/admin/scoring", { who: anu })).status).toBe(403);
    expect((await call("/api/v1/admin/competitions/kathai/ranking")).status).toBe(401);
    expect((await call("/api/v1/admin/competitions/no-such-thing/ranking", { who: admin })).status).toBe(404);
  });

  it("an entry nobody is assigned to is listed as not assigned, unranked", async () => {
    const admin = await signIn("admin");
    await entry("RIOSCOREF6", "Farah"); // submitted after the assignments above
    const r = await call("/api/v1/admin/competitions/kathai/ranking", { who: admin });
    expect((r.body.entries as Json[]).find((x) => x.entryCode === "RIOSCOREF6")).toMatchObject({ assigned: 0, rank: null, average: null, judges: [] });
    expect(r.body.summary.notAssigned).toBe(1);
  });

  describe("winners (chosen by hand, public only after the Event Settings time)", () => {
    const winners = (who: Who | null) => call("/api/v1/admin/competitions/kathai/winners", { who });
    const approve = (who: Who, body: Json) => call("/api/v1/admin/competitions/kathai/winners", { method: "POST", who, body: { confirm: true, ...body } });
    const AWARD = "குட்டிக் கதைச் செல்வன் / செல்வி";

    it("approves, refuses every wrong choice with a clear code, removes, audits without names, and publishes nothing by itself", async () => {
      const admin = await signIn("admin");
      const judge = await signIn("judge", "Mani");
      const before = (await winners(admin)).body;
      expect(before).toMatchObject({ publishAt: null, frozen: false, winners: [] });
      expect(before.candidates.map((c: Json) => c.entryCode).slice(0, 3)).toEqual(["RIOSCOREC3", "RIOSCOREA1", "RIOSCOREB2"]); // ranking order

      const ok = await approve(admin, { entryCode: "RIOSCOREC3", place: 1, displayName: "  Chitra  ", awardLabel: AWARD });
      expect(ok.status, ok.text).toBe(201);
      expect(ok.body.winners).toEqual([expect.objectContaining({ place: 1, entryCode: "RIOSCOREC3", displayName: "Chitra", awardLabel: AWARD, average: 9.5, rank: 1 })]);

      for (const [body, status, code] of [
        [{ entryCode: "RIOSCOREA1", place: 1, displayName: "Asha" }, 409, "place_taken"],
        [{ entryCode: "RIOSCOREC3", place: 2, displayName: "Chitra" }, 409, "already_winner"],
        [{ entryCode: "RIOSCOREE5", place: 2, displayName: "Eswar" }, 409, "entry_not_finalized"], // held for review
        [{ entryCode: "NOSUCHCODE", place: 2, displayName: "X" }, 404, "entry_not_found"],
      ] as const) {
        const r = await approve(admin, body);
        expect(r.status, JSON.stringify(body)).toBe(status);
        expect(r.body.error.code).toBe(code);
      }
      for (const body of [{ entryCode: "RIOSCOREA1", place: 11, displayName: "Asha" }, { entryCode: "RIOSCOREA1", place: 2, displayName: "" }, { entryCode: "RIOSCOREA1", place: 2, displayName: "<b>x</b>" }]) {
        expect((await approve(admin, body)).status, JSON.stringify(body)).toBe(400);
      }
      expect((await call("/api/v1/admin/competitions/kathai/winners", { method: "POST", who: admin, body: { entryCode: "RIOSCOREA1", place: 2, displayName: "Asha" } })).status).toBe(400); // no confirm
      expect((await approve(judge, { entryCode: "RIOSCOREA1", place: 2, displayName: "Asha" })).status).toBe(403);
      expect((await winners(judge)).status).toBe(403);
      expect((await winners(null)).status).toBe(401);

      // approving is not publishing: the public page still says pending
      expect((await call("/api/v1/results")).body).toEqual({ state: "pending" });
      const overview = (await call("/api/v1/admin/results", { who: admin })).body;
      expect(overview.competitions.find((c: Json) => c.slug === "kathai")).toMatchObject({ winners: 1, finalized: 5 });

      const removed = await call("/api/v1/admin/competitions/kathai/winners/1", { method: "DELETE", who: admin });
      expect(removed.status, removed.text).toBe(200);
      expect(removed.body.winners).toEqual([]);
      expect((await call("/api/v1/admin/competitions/kathai/winners/1", { method: "DELETE", who: admin })).status).toBe(404);

      const audit = (await sql<{ action: string; details: string | null }>("SELECT action, details FROM audit_log WHERE action LIKE 'winner.%' ORDER BY id")).rows;
      expect(audit.map((a) => a.action)).toEqual(["winner.approved", "winner.removed"]);
      expect(JSON.stringify(audit)).not.toMatch(/Chitra|RIOSCORE|செல்வன்/);
    });

    it("once the publication time has passed, winners are frozen: no adding, no removing", async () => {
      const admin = await signIn("admin");
      expect((await approve(admin, { entryCode: "RIOSCOREB2", place: 3, displayName: "Bala" })).status).toBe(201);
      const publishAt = new Date(Date.UTC(2026, 10, 14, 4, 30)); // 14 Nov 2026, 10:00 IST: on or after the approved floor
      await sql("UPDATE event_settings SET submissions_open_at = ?, submissions_close_at = ?, guardian_consent_version = 'v1', results_publish_at = ? WHERE id = 1", [
        new Date(Date.UTC(2026, 10, 10)), new Date(Date.UTC(2026, 10, 13)), publishAt,
      ]);
      try {
        clock.t = publishAt.getTime() + 60_000;
        const later = await signIn("admin"); // sessions last hours, so sign in again on the later day
        const view = (await winners(later)).body;
        expect(view).toMatchObject({ frozen: true, publishAt: publishAt.toISOString() });
        const add = await approve(later, { entryCode: "RIOSCOREA1", place: 2, displayName: "Asha" });
        expect(add.status).toBe(409);
        expect(add.body.error.code).toBe("results_frozen");
        const del = await call("/api/v1/admin/competitions/kathai/winners/3", { method: "DELETE", who: later });
        expect(del.status).toBe(409);
        expect(del.body.error.code).toBe("results_frozen");
      } finally {
        clock.t = null;
        await sql("UPDATE event_settings SET results_publish_at = NULL, submissions_open_at = NULL, submissions_close_at = NULL, guardian_consent_version = NULL WHERE id = 1");
      }
    });
  });
});
