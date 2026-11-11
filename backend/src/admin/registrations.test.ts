import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { hashPassword } from "../auth/password.ts";
import type { DatabaseAdapter, Dialect } from "../db/adapter.ts";
import { dialects, openTestDatabase } from "../db/test-db.ts";
import { dropAppSchema, installAppSchema } from "../db/test-schema.ts";
import { captureLogger, listen, testConfig } from "../test-helpers.ts";

// The administrator's registration list and detail, against a disposable database (in-memory SQLite always; a *_test MySQL-protocol database when configured).

const ORIGIN = "http://admin.test";
const COST = { memoryKib: 1024, passes: 1 };
const TRACKING = "zz_admin_registrations_migrations";
const OPTIONS = JSON.stringify([{ code: "a", ta: "அ", en: "Alpha" }, { code: "b", ta: "ஆ", en: "Beta" }, { code: "c", ta: "இ", en: "Gamma" }]);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { cookie: string };

describe.each(dialects)("%s admin registrations", (dialect: Dialect) => {
  let db: DatabaseAdapter;
  let server: Server;
  let base: string;
  let counter = 0;
  const now = () => new Date();
  const config = testConfig({ ALLOWED_ORIGINS: ORIGIN, TRUST_PROXY_HOPS: "1", ARGON2_MEMORY_KIB: String(COST.memoryKib), ARGON2_PASSES: String(COST.passes) });
  const sql = <Row = Record<string, unknown>>(text: string, params: readonly (string | number | Date | null)[] = []) => db.query<Row>(text, params);
  const scalar = async (text: string, params: readonly (string | number | Date | null)[] = []) => Number((await sql<{ n: number }>(text, params)).rows[0]!.n);
  const ids: Record<string, number> = {};

  async function signIn(role: "super_admin" | "admin" | "judge"): Promise<Who> {
    const email = `${role}${++counter}@example.org`;
    const password = `Start-Pass-${counter}-xyz`;
    await sql("INSERT INTO staff_users (email, password_hash, role, display_name, active, must_change_password, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)", [email, await hashPassword(password, COST), role, "Staff", now()]);
    const res = await fetch(`${base}/api/v1/staff/login`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": `10.7.${counter % 250}.${counter % 200}` }, body: JSON.stringify({ email, password }) });
    return { cookie: res.headers.getSetCookie()[0]!.split(";")[0]! };
  }
  async function get(path: string, who: Who | null): Promise<{ status: number; body: Json; text: string }> {
    const res = await fetch(base + path, { headers: { ...(who ? { cookie: who.cookie } : {}), "x-forwarded-for": "10.6.0.1" } });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Json) : {}, text };
  }

  async function addEvent(slug: string, order: number): Promise<number> {
    await sql("INSERT INTO events (slug, name_ta, name_en, min_age, max_age, display_order) VALUES (?, ?, ?, 3, 12, ?)", [slug, `போட்டி ${slug}`, `Contest ${slug}`, order]);
    return Number((await sql<{ id: number }>("SELECT id FROM events WHERE slug = ?", [slug])).rows[0]!.id);
  }
  async function publishSet(eventId: number, version: number, prompt = "Question"): Promise<number> {
    await sql("INSERT INTO question_sets (event_id, version) VALUES (?, ?)", [eventId, version]);
    const setId = Number((await sql<{ id: number }>("SELECT id FROM question_sets WHERE event_id = ? AND version = ?", [eventId, version])).rows[0]!.id);
    const rows: [string, string, number, string | null, number][] = [
      ["school", "short_text", 1, null, 1],
      ["group", "dropdown", 2, OPTIONS, 0],
      ["hobbies", "checkboxes", 3, OPTIONS, 0],
      ["note", "instruction", 4, null, 0],
      ["unanswered", "short_text", 5, null, 0],
    ];
    for (const [key, type, position, options, required] of rows) {
      await sql("INSERT INTO questions (question_set_id, position, question_key, type, prompt_ta, prompt_en, required, options_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [setId, position, key, type, `கேள்வி ${key}`, `${prompt} ${key}`, required, options]);
    }
    await sql("UPDATE question_sets SET status = 'published', published_at = ? WHERE id = ?", [now(), setId]);
    return setId;
  }
  async function addEntry(code: string, eventId: number, setId: number, over: { status?: string; childName?: string } = {}): Promise<number> {
    await sql(
      "INSERT INTO submissions (entry_code, event_id, question_set_id, child_name, child_name_norm, child_age, guardian_name, guardian_mobile, guardian_email, guardian_consent_version, guardian_consent_at, media_consent, media_consent_version, media_consent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 5, 'Parent Person', '+919876543210', 'parent@example.org', 'v1', ?, 1, 'm1', ?, ?, ?)",
      [code, eventId, setId, over.childName ?? "Child Person", (over.childName ?? "Child Person").toLowerCase(), now(), now(), new Date(Date.now() - ++counter * 1000), now()],
    );
    const id = Number((await sql<{ id: number }>("SELECT id FROM submissions WHERE entry_code = ?", [code])).rows[0]!.id);
    if (over.status && over.status !== "draft") {
      await sql("UPDATE submissions SET status = 'withdrawn', withdrawn_at = ? WHERE id = ?", [now(), id]);
    }
    return id;
  }
  async function answer(submissionId: number, setId: number, key: string, value: { text?: string; list?: string[] }) {
    const q = (await sql<{ id: number; type: string }>("SELECT id, type FROM questions WHERE question_set_id = ? AND question_key = ?", [setId, key])).rows[0]!;
    await sql("INSERT INTO entry_answers (submission_id, question_set_id, question_id, question_type, value_text, value_number, value_json, answered_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)", [
      submissionId, setId, Number(q.id), q.type, value.text ?? null, value.list ? JSON.stringify(value.list) : null, now(),
    ]);
  }

  beforeAll(async () => {
    db = openTestDatabase(dialect);
    await installAppSchema(db, TRACKING);
    server = createServer(createApp({ config, logger: captureLogger().logger, state: { shuttingDown: false }, db, now }));
    base = await listen(server);
    ids.a = await addEvent("alpha-contest", 1);
    ids.b = await addEvent("beta-contest", 2);
    ids.setA1 = await publishSet(ids.a, 1);
    ids.setB1 = await publishSet(ids.b, 1);
  }, 120_000);
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await dropAppSchema(db, TRACKING);
    await db.close();
  });

  it("is closed to anonymous callers (401) and to a judge (403), open to an administrator and a Super Admin", async () => {
    const judge = await signIn("judge");
    expect((await get("/api/v1/admin/registrations", null)).status).toBe(401);
    expect((await get("/api/v1/admin/registrations/RIO00001", null)).status).toBe(401);
    expect((await get("/api/v1/admin/registrations", judge)).status).toBe(403);
    expect((await get("/api/v1/admin/registrations/RIO00001", judge)).status).toBe(403);
    expect((await get("/api/v1/admin/registrations", await signIn("admin"))).status).toBe(200);
    expect((await get("/api/v1/admin/registrations", await signIn("super_admin"))).status).toBe(200);
  });

  it("lists nothing on an empty database, then real rows with names but no contact details", async () => {
    const admin = await signIn("admin");
    expect((await get("/api/v1/admin/registrations", admin)).body).toEqual({ registrations: [], total: 0, page: 1, pageSize: 25 });
    const id = await addEntry("RIO00001", ids.a!, ids.setA1!);
    await answer(id, ids.setA1!, "school", { text: "Rio School" });
    const { body, text } = await get("/api/v1/admin/registrations", admin);
    expect(body.total).toBe(1);
    expect(body.registrations[0]).toMatchObject({ entryCode: "RIO00001", status: "draft", competitionSlug: "alpha-contest", questionSetVersion: 1, childName: "Child Person", childAge: 5, guardianName: "Parent Person", answered: 1, hasVideo: false, openDuplicateFlag: false });
    expect(text).not.toContain("9876543210");
    expect(text).not.toContain("parent@example.org");
  });

  it("filters by competition and status, pages by 25, and rejects unknown or malformed filters", async () => {
    const admin = await signIn("admin");
    await addEntry("RIO00002", ids.b!, ids.setB1!, { childName: "Beta Child" });
    await addEntry("RIO00003", ids.b!, ids.setB1!, { childName: "Withdrawn Child", status: "withdrawn" });
    expect((await get("/api/v1/admin/registrations?competition=beta-contest", admin)).body.total).toBe(2);
    expect((await get("/api/v1/admin/registrations?competition=alpha-contest", admin)).body.total).toBe(1);
    expect((await get("/api/v1/admin/registrations?status=withdrawn", admin)).body.registrations.map((r: Json) => r.entryCode)).toEqual(["RIO00003"]);
    expect((await get("/api/v1/admin/registrations?competition=no-such-contest", admin)).body.total).toBe(0);
    for (let i = 4; i <= 29; i++) await addEntry(`RIO${String(i).padStart(5, "0")}`, ids.a!, ids.setA1!);
    const first = (await get("/api/v1/admin/registrations", admin)).body;
    const second = (await get("/api/v1/admin/registrations?page=2", admin)).body;
    expect(first.total).toBe(29);
    expect(first.registrations).toHaveLength(25);
    expect(second.registrations).toHaveLength(4);
    expect(new Set([...first.registrations, ...second.registrations].map((r: Json) => r.entryCode)).size).toBe(29);
    for (const bad of ["page=0", "page=abc", "status=bogus", "competition=Bad_Slug", "extra=1", "page=1&page=2"]) {
      expect((await get(`/api/v1/admin/registrations?${bad}`, admin)).status, bad).toBe(400);
    }
  });

  it("shows one entry in full against the question set it was created with, and audits the view without personal data", async () => {
    const admin = await signIn("admin");
    const id = await addEntry("RIO00100", ids.a!, ids.setA1!, { childName: "Detail Child" });
    await answer(id, ids.setA1!, "school", { text: "Rio School" });
    await answer(id, ids.setA1!, "group", { text: "b" });
    await answer(id, ids.setA1!, "hobbies", { list: ["a", "c"] });
    // A newer version is published afterwards: the entry must keep showing version 1.
    await sql("UPDATE question_sets SET status = 'retired', retired_at = ? WHERE id = ?", [now(), ids.setA1!]);
    await publishSet(ids.a!, 2, "CHANGED");

    const before = await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'registration.viewed'");
    const { status, body, text } = await get("/api/v1/admin/registrations/RIO00100", admin);
    expect(status).toBe(200);
    const r = body.registration;
    expect(r).toMatchObject({
      entryCode: "RIO00100", status: "draft", questionSetVersion: 1, competition: { slug: "alpha-contest" },
      child: { name: "Detail Child", age: 5 }, guardian: { name: "Parent Person", mobile: "+919876543210", email: "parent@example.org" },
      consent: { guardian: { version: "v1" }, media: { granted: true, version: "m1" } },
    });
    expect(r.answers.map((a: Json) => a.key)).toEqual(["school", "group", "hobbies", "unanswered"]); // the instruction is not an answer
    expect(r.answers[0]).toMatchObject({ value: "Rio School", required: true, chosen: null });
    expect(r.answers[1]).toMatchObject({ value: "b", chosen: [{ ta: "ஆ", en: "Beta" }] });
    expect(r.answers[2]).toMatchObject({ value: ["a", "c"], chosen: [{ ta: "அ", en: "Alpha" }, { ta: "இ", en: "Gamma" }] });
    expect(r.answers[3]).toMatchObject({ value: null });
    expect(r.video).toEqual({ uploaded: false, bytes: null, contentType: null, uploadedAt: null });
    // once the entry has its checked video, the list and the detail say so (an unfinished upload does not count), without any storage key
    const key = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await sql("INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at) VALUES (?, 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'video/mp4', 200000, 'issued', ?)", [id, new Date(Date.now() + 3_600_000)]);
    expect((await get("/api/v1/admin/registrations/RIO00100", admin)).body.registration.video.uploaded).toBe(false);
    await sql("INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at, verified_at, verified_bytes) VALUES (?, ?, 'video/mp4', 7000000, 'verified', ?, ?, 7000000)", [id, key, new Date(Date.now() + 3_600_000), now()]);
    const withVideo = await get("/api/v1/admin/registrations/RIO00100", admin);
    expect(withVideo.body.registration.video).toMatchObject({ uploaded: true, bytes: 7000000, contentType: "video/mp4" });
    expect(withVideo.text).not.toContain(key);
    let listed: Json | undefined;
    for (let page = 1; !listed && page <= 5; page++) listed = (await get(`/api/v1/admin/registrations?page=${page}`, admin)).body.registrations.find((x: Json) => x.entryCode === "RIO00100");
    expect(listed?.hasVideo).toBe(true);
    expect(text).not.toContain("CHANGED");
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'registration.viewed'")).toBe(before + 3); // one view per open: the first, and the two video checks above
    const audit = (await sql<{ details: string | null; entity_id: string }>("SELECT details, entity_id FROM audit_log WHERE action = 'registration.viewed' ORDER BY id DESC LIMIT 1")).rows[0]!;
    expect(audit.entity_id).toBe(String(id));
    expect(`${audit.details ?? ""}`).not.toMatch(/Detail Child|Parent Person|9876543210|parent@example/);
  });

  it("answers 404 for an unknown or malformed entry code and writes no audit row for it", async () => {
    const admin = await signIn("admin");
    const before = await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'registration.viewed'");
    for (const code of ["RIO99999", "rio00100", "SHORT", "RIO00100%27", "WAYTOOLONGENTRYCODE12"]) {
      expect((await get(`/api/v1/admin/registrations/${code}`, admin)).status, code).toBe(404);
    }
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'registration.viewed'")).toBe(before);
  });
});
