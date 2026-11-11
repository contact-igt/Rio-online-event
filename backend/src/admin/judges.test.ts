import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { hashPassword } from "../auth/password.ts";
import { COMPETITIONS } from "../db/seed/competitions.ts";
import type { DatabaseAdapter, Dialect } from "../db/adapter.ts";
import { dialects, openTestDatabase } from "../db/test-db.ts";
import { dropAppSchema, installAppSchema } from "../db/test-schema.ts";
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
  const sql = <Row = Record<string, unknown>>(text: string, params: readonly (string | number | Date | null)[] = []) =>
    db.query<Row>(text, params);

  beforeAll(async () => {
    db = openTestDatabase(dialect);
    await installAppSchema(db, TRACKING);
    server = createServer(createApp({ config, logger: captureLogger().logger, state: { shuttingDown: false }, db, now }));
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

  async function signIn(role: "admin" | "judge"): Promise<Who> {
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

  it("admin can provision a judge and list judges", async () => {
    const admin = await signIn("admin");
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
    const admin = await signIn("admin");
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

  it("judge can view assigned entries and score 0 to 10", async () => {
    const admin = await signIn("admin");
    const judge = await signIn("judge");

    // Create a finalized submission
    const eventRes = await sql<{ id: number }>("SELECT id FROM events WHERE slug = 'malalai-mozhi'");
    const eventId = Number(eventRes.rows[0]!.id);
    const subRes = await sql(
      `INSERT INTO submissions (event_id, question_set_id, status, child_name, child_age, guardian_name, guardian_mobile, guardian_consent_version, created_at)
       VALUES (?, 1, 'finalized', 'Arjun', 4, 'Meena', '+919876543210', 'v1', ?)`,
      [eventId, now()],
    );
    const subId = Number(subRes.insertId);
    const entryCode = (await sql<{ entry_code: string }>("SELECT entry_code FROM submissions WHERE id = ?", [subId])).rows[0]!.entry_code;

    // Add a verified video upload
    await sql(
      `INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at, verified_at, verified_bytes)
       VALUES (?, '11111111-2222-3333-4444-555555555555', 'video/mp4', 1048576, 'verified', ?, ?, 1048576)`,
      [subId, new Date(now().getTime() + 3600_000), now()],
    );

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
});

