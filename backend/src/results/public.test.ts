import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { hashPassword } from "../auth/password.ts";
import type { DatabaseAdapter, Dialect } from "../db/adapter.ts";
import { dialects, openTestDatabase } from "../db/test-db.ts";
import { dropAppSchema, installAppSchema } from "../db/test-schema.ts";
import { captureLogger, listen, testConfig } from "../test-helpers.ts";

// The public results endpoint against a disposable database. The publication time is checked by the database view with the database's own
// clock, so the "published" case waits about a second of real time instead of faking it.

const TRACKING = "zz_results_migrations";
const HOUR = 3_600_000;

describe.each(dialects)("%s public results", (dialect: Dialect) => {
  let db: DatabaseAdapter;
  let server: Server;
  let base: string;
  let clockOffset = 0;
  const entry = { eventId: 0, submissionId: 0, staffId: 0 };
  const now = () => new Date(Date.now() + clockOffset);
  const sql = <Row = Record<string, unknown>>(text: string, params: readonly (string | number | Date | null)[] = []) => db.query<Row>(text, params);
  const results = async () => {
    const res = await fetch(`${base}/api/v1/results`);
    return { status: res.status, cacheControl: res.headers.get("cache-control"), body: (await res.json()) as Record<string, unknown>, cookies: res.headers.getSetCookie() };
  };

  beforeAll(async () => {
    db = openTestDatabase(dialect);
    await installAppSchema(db, TRACKING);
    server = createServer(createApp({ config: testConfig({ ARGON2_MEMORY_KIB: "1024", ARGON2_PASSES: "1" }), logger: captureLogger().logger, state: { shuttingDown: false }, db, now }));
    base = await listen(server);

    await sql("INSERT INTO events (slug, name_ta, name_en, min_age, max_age, display_order) VALUES ('alpha-contest', 'அ', 'Alpha', 3, 12, 1)");
    const eventId = Number((await sql<{ id: number }>("SELECT id FROM events WHERE slug = 'alpha-contest'")).rows[0]!.id);
    await sql("INSERT INTO question_sets (event_id, version) VALUES (?, 1)", [eventId]);
    const setId = Number((await sql<{ id: number }>("SELECT id FROM question_sets WHERE event_id = ?", [eventId])).rows[0]!.id);
    await sql("UPDATE question_sets SET status = 'published', published_at = ? WHERE id = ?", [now(), setId]);
    await sql("INSERT INTO staff_users (email, password_hash, role, display_name, active, must_change_password, created_at) VALUES ('a@example.org', ?, 'admin', 'Admin', 1, 0, ?)", [await hashPassword("Start-Pass-123-xyz", { memoryKib: 1024, passes: 1 }), now()]);
    const staffId = Number((await sql<{ id: number }>("SELECT id FROM staff_users WHERE email = 'a@example.org'")).rows[0]!.id);
    await sql(
      "INSERT INTO submissions (entry_code, event_id, question_set_id, child_name, child_name_norm, child_age, guardian_name, guardian_mobile, guardian_consent_version, guardian_consent_at, created_at, updated_at) VALUES ('RIO00001', ?, ?, 'Winner Child', 'winner child', 5, 'Parent', '+919876543210', 'v1', ?, ?, ?)",
      [eventId, setId, now(), now(), now()],
    );
    const entryId = Number((await sql<{ id: number }>("SELECT id FROM submissions WHERE entry_code = 'RIO00001'")).rows[0]!.id);
    await sql("INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at, verified_at, verified_bytes) VALUES (?, ?, 'video/mp4', 200000, 'verified', ?, ?, 200000)", [entryId, randomUUID(), new Date(Date.now() + HOUR), now()]);
    await sql("UPDATE submissions SET status = 'finalized', submitted_at = ?, finalized_at = ? WHERE id = ?", [now(), now(), entryId]);
    Object.assign(entry, { eventId, submissionId: entryId, staffId });
    await sql("INSERT INTO winners (event_id, submission_id, place, award_label, display_name, approved_by) VALUES (?, ?, 1, 'Gold', 'Winner C.', ?)", [eventId, entryId, staffId]);
  }, 120_000);
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await dropAppSchema(db, TRACKING);
    await db.close();
  });

  it("shows nothing while no publication time is set, even though a winner row exists", async () => {
    const reply = await results();
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ state: "pending" });
    expect(reply.cacheControl).toBe("no-store");
    expect(reply.cookies).toEqual([]);
  });

  it("reports published with an empty list once the time has passed and nobody was approved", async () => {
    const start = Date.now();
    await sql("DELETE FROM winners WHERE submission_id = ?", [entry.submissionId]); // allowed: nothing is published yet
    await sql("UPDATE event_settings SET submissions_open_at = ?, submissions_close_at = ?, guardian_consent_version = 'v1', results_publish_at = ? WHERE id = 1", [new Date(start - 2 * HOUR), new Date(start + HOUR), new Date(start + 2 * HOUR)]);
    expect((await results()).body).toEqual({ state: "pending" });
    clockOffset = 3 * HOUR; // the endpoint's clock moves past the publication time; the database clock does not
    expect((await results()).body).toEqual({ state: "published", winners: [] });
    clockOffset = 0;
    await sql("UPDATE event_settings SET results_publish_at = NULL, submissions_open_at = NULL, submissions_close_at = NULL, guardian_consent_version = NULL WHERE id = 1");
  });

  it("shows nothing before the publication time, and the winner afterwards (display name only)", async () => {
    await sql("INSERT INTO winners (event_id, submission_id, place, award_label, display_name, approved_by) VALUES (?, ?, 1, 'Gold', 'Winner C.', ?)", [entry.eventId, entry.submissionId, entry.staffId]);
    const start = Date.now();
    await sql("UPDATE event_settings SET submissions_open_at = ?, submissions_close_at = ?, guardian_consent_version = 'v1', results_publish_at = ? WHERE id = 1", [new Date(start - 2 * HOUR), new Date(start + 400), new Date(start + 1200)]);
    expect((await results()).body).toEqual({ state: "pending" });
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, start + 1500 - Date.now())));
    const reply = await results();
    expect(reply.body).toEqual({ state: "published", winners: [{ eventSlug: "alpha-contest", place: 1, awardLabel: "Gold", displayName: "Winner C." }] });
    expect(JSON.stringify(reply.body)).not.toMatch(/Winner Child|RIO00001|9876543210/);
  });
});
