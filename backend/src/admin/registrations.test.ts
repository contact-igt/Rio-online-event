import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { hashPassword } from "../auth/password.ts";
import type { DatabaseAdapter, Dialect } from "../db/adapter.ts";
import { dialects, openTestDatabase } from "../db/test-db.ts";
import { dropAppSchema, installAppSchema } from "../db/test-schema.ts";
import type { VideoStore } from "../storage/r2.ts";
import { captureLogger, listen, testConfig } from "../test-helpers.ts";

// The administrator's registration list and detail, against a disposable database (in-memory SQLite always; a *_test MySQL-protocol database when configured).

const ORIGIN = "http://admin.test";
const COST = { memoryKib: 1024, passes: 1 };
const TRACKING = "zz_admin_registrations_migrations";
const OPTIONS = JSON.stringify([{ code: "a", ta: "அ", en: "Alpha" }, { code: "b", ta: "ஆ", en: "Beta" }, { code: "c", ta: "இ", en: "Gamma" }]);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { cookie: string; csrf: string };

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
  // A fake private bucket: remembers what was removed, and can be told to fail.
  const bucket = { removed: [] as string[], fail: false, signed: [] as { key: string; seconds: number }[] };
  const fakeStore = {
    remove: async (key: string) => { if (bucket.fail) throw new Error("storage down"); bucket.removed.push(key); },
    presignGet: async (key: string, o: { expiresInSeconds: number }) => { bucket.signed.push({ key, seconds: o.expiresInSeconds }); return `https://bucket.test/${key}?sig=1`; },
  } as unknown as VideoStore;

  async function signIn(role: "super_admin" | "admin" | "judge"): Promise<Who> {
    const email = `${role}${++counter}@example.org`;
    const password = `Start-Pass-${counter}-xyz`;
    await sql("INSERT INTO staff_users (email, password_hash, role, display_name, active, must_change_password, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)", [email, await hashPassword(password, COST), role, "Staff", now()]);
    const res = await fetch(`${base}/api/v1/staff/login`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": `10.7.${counter % 250}.${counter % 200}` }, body: JSON.stringify({ email, password }) });
    const body = (await res.json()) as Json;
    return { cookie: res.headers.getSetCookie()[0]!.split(";")[0]!, csrf: body.csrfToken as string };
  }
  async function get(path: string, who: Who | null): Promise<{ status: number; body: Json; text: string }> {
    const res = await fetch(base + path, { headers: { ...(who ? { cookie: who.cookie } : {}), "x-forwarded-for": "10.6.0.1" } });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Json) : {}, text };
  }
  async function mutate(path: string, method: "PATCH" | "DELETE" | "POST", who: Who | null, body?: unknown): Promise<{ status: number; body: Json; text: string }> {
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": "10.6.0.1",
        ...(who ? { cookie: who.cookie, "x-csrf-token": who.csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
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
    server = createServer(createApp({ config, logger: captureLogger().logger, state: { shuttingDown: false }, db, now, video: fakeStore }));
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

  it("allows draft edit and soft delete only to Super Admin, preserving the deleted row and audit", async () => {
    const boss = await signIn("super_admin");
    const admin = await signIn("admin");
    const judge = await signIn("judge");
    const latestVersion = Number((await sql<{ version: number }>("SELECT MAX(version) AS version FROM question_sets WHERE event_id = ?", [ids.a!])).rows[0]!.version ?? 0);
    await sql("UPDATE question_sets SET status = 'retired', retired_at = ? WHERE event_id = ? AND status = 'published'", [now(), ids.a!]);
    const activeSet = await publishSet(ids.a!, latestVersion + 1, "Edit");
    const draftId = await addEntry("EDIT0001", ids.a!, activeSet);
    const protectedId = await addEntry("LOCK0001", ids.a!, activeSet, { status: "withdrawn" });

    const editBody = { childName: "Edited Child", childAge: 6, guardianName: "Edited Parent", guardianMobile: "+919876543219", guardianEmail: "edited@example.org" };
    expect((await mutate("/api/v1/admin/registrations/EDIT0001", "PATCH", admin, editBody)).status).toBe(200);
    expect((await mutate("/api/v1/admin/registrations/EDIT0001", "PATCH", judge, editBody)).status).toBe(403);
    expect((await mutate("/api/v1/admin/registrations/EDIT0001", "PATCH", boss, { ...editBody, childAge: 99 })).status).toBe(400);
    expect((await mutate("/api/v1/admin/registrations/EDIT0001", "PATCH", boss, editBody)).status).toBe(200);
    expect((await get("/api/v1/admin/registrations/EDIT0001", admin)).body.registration).toMatchObject({ child: { name: "Edited Child", age: 6 }, guardian: { name: "Edited Parent", mobile: "+919876543219", email: "edited@example.org" } });

    expect((await mutate("/api/v1/admin/registrations/LOCK0001", "DELETE", admin)).status).toBe(403);
    expect((await mutate("/api/v1/admin/registrations/EDIT0001", "DELETE", judge)).status).toBe(403);
    expect((await mutate("/api/v1/admin/registrations/LOCK0001", "DELETE", boss)).status).toBe(409);
    expect((await mutate("/api/v1/admin/registrations/EDIT0001", "DELETE", boss)).status).toBe(200);
    expect((await get("/api/v1/admin/registrations", admin)).body.registrations.some((r: Json) => r.entryCode === "EDIT0001")).toBe(false);
    expect((await get("/api/v1/admin/registrations/EDIT0001", admin)).status).toBe(404);
    expect(Number((await scalar("SELECT COUNT(*) AS n FROM submissions WHERE id = ? AND deleted_at IS NOT NULL", [draftId])))).toBe(1);
    expect(Number((await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'registration.deleted' AND entity_id = ?", [String(draftId)])))).toBe(1);
    expect(Number((await scalar("SELECT COUNT(*) AS n FROM submissions WHERE id = ?", [protectedId])))).toBe(1);
  });

  it("lists deleted drafts only to Super Admin and restores them without changing identity", async () => {
    const boss = await signIn("super_admin");
    const admin = await signIn("admin");
    const judge = await signIn("judge");
    const activeSet = Number((await sql<{ id: number }>("SELECT id FROM question_sets WHERE event_id = ? AND status = 'published'", [ids.a!])).rows[0]!.id);
    const restoredId = await addEntry("REST0001", ids.a!, activeSet, { childName: "Restore Child" });
    expect((await mutate("/api/v1/admin/registrations/REST0001", "DELETE", boss)).status).toBe(200);

    expect((await get("/api/v1/admin/registrations/deleted", admin)).status).toBe(403);
    expect((await get("/api/v1/admin/registrations/deleted", judge)).status).toBe(403);
    const deleted = await get("/api/v1/admin/registrations/deleted?q=REST0001", boss);
    expect(deleted.status).toBe(200);
    expect(deleted.body.registrations).toMatchObject([{ entryCode: "REST0001", status: "draft", childName: "Restore Child", deletedBy: "Staff" }]);
    expect(deleted.body.registrations[0].deletedAt).toEqual(expect.any(String));
    expect((await get("/api/v1/admin/registrations", admin)).body.registrations.some((r: Json) => r.entryCode === "REST0001")).toBe(false);

    expect((await mutate("/api/v1/admin/registrations/REST0001/restore", "POST", admin)).status).toBe(403);
    expect((await mutate("/api/v1/admin/registrations/REST0001/restore", "POST", judge)).status).toBe(403);
    expect((await mutate("/api/v1/admin/registrations/REST0001/restore", "POST", boss)).status).toBe(200);
    expect((await get("/api/v1/admin/registrations/REST0001", admin)).body.registration).toMatchObject({ entryCode: "REST0001", status: "draft", child: { name: "Restore Child" }, guardian: { name: "Parent Person" } });
    expect(Number((await scalar("SELECT COUNT(*) AS n FROM submissions WHERE id = ? AND deleted_at IS NULL", [restoredId])))).toBe(1);
    expect(Number((await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'registration.restored' AND entity_id = ?", [String(restoredId)])))).toBe(1);

    const heldId = await addEntry("REST0002", ids.a!, activeSet, { childName: "Conflict Child" });
    await sql("INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at, verified_at, verified_bytes) VALUES (?, ?, 'video/mp4', 200000, 'verified', ?, ?, 200000)", [heldId, "11111111-1111-4111-8111-111111111111", new Date(Date.now() + 3_600_000), now()]);
    await sql("UPDATE submissions SET status = 'held', submitted_at = ? WHERE id = ?", [now(), heldId]);
    await addEntry("REST0003", ids.a!, activeSet, { childName: "Conflict Child" });
    expect((await mutate("/api/v1/admin/registrations/REST0003", "DELETE", boss)).status).toBe(200);
    expect((await mutate("/api/v1/admin/registrations/REST0003/restore", "POST", boss)).status).toBe(409);
  });

  it("searches code, child and guardian names, sorts with an allowlist, and combines both with the filters and paging", async () => {
    const admin = await signIn("admin");
    const live = async (eventId: number) => Number((await sql<{ id: number }>("SELECT id FROM question_sets WHERE event_id = ? AND status = 'published'", [eventId])).rows[0]!.id);
    const [setA, setB] = [await live(ids.a!), await live(ids.b!)];
    await addEntry("SRCH0001", ids.a!, setA, { childName: "Zed Searchable" });
    await addEntry("SRCH0002", ids.b!, setB, { childName: "Abe Searchable" });
    await addEntry("SRCH0003", ids.a!, setA, { childName: "Pct 100% Sure" });
    const codes = async (query: string) => (await get(`/api/v1/admin/registrations?${query}`, admin)).body.registrations.map((r: Json) => r.entryCode);
    expect(await codes("q=searchable&sort=child_asc")).toEqual(["SRCH0002", "SRCH0001"]);
    expect(await codes("q=searchable&sort=child_desc")).toEqual(["SRCH0001", "SRCH0002"]);
    expect(await codes("q=SRCH0003")).toEqual(["SRCH0003"]); // by reference
    expect(await codes("q=parent person&competition=beta-contest&sort=oldest")).toContain("SRCH0002"); // by guardian name, with a filter
    expect(await codes("q=searchable&competition=alpha-contest")).toEqual(["SRCH0001"]);
    expect(await codes("q=100%25")).toEqual(["SRCH0003"]); // a typed % matches itself, not everything
    expect(await codes("q=_")).toEqual([]);
    const all = (await get("/api/v1/admin/registrations?q=searchable", admin)).body;
    expect(all.total).toBe(2);
    // video and duplicate filters, combined with search
    const withVideo = await sql<{ id: number }>("SELECT id FROM submissions WHERE entry_code = 'SRCH0001'");
    await sql("INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at, verified_at, verified_bytes) VALUES (?, ?, 'video/mp4', 200000, 'verified', ?, ?, 200000)", [Number(withVideo.rows[0]!.id), 'aaaaaaaa-aaaa-4ccc-8ddd-eeeeeeeeeeee', new Date(Date.now() + 3_600_000), now()]);
    expect(await codes("q=searchable&video=uploaded")).toEqual(["SRCH0001"]);
    expect(await codes("q=searchable&video=none")).toEqual(["SRCH0002"]);
    expect(await codes("q=searchable&duplicate=1")).toEqual([]);
    expect((await get("/api/v1/admin/registrations?video=maybe", admin)).status).toBe(400);
    expect((await get("/api/v1/admin/registrations?sort=id%3B%20DROP", admin)).status).toBe(400); // only named sorts are accepted
    expect((await get(`/api/v1/admin/registrations?q=${"x".repeat(81)}`, admin)).status).toBe(400);
  });

  it("permanently deletes only a soft-deleted draft, for the Super Admin, removing its stored video first and keeping a minimal audit row", async () => {
    const boss = await signIn("super_admin");
    const admin = await signIn("admin");
    const judge = await signIn("judge");
    const live = async (eventId: number) => Number((await sql<{ id: number }>("SELECT id FROM question_sets WHERE event_id = ? AND status = 'published'", [eventId])).rows[0]!.id);
    const setA = await live(ids.a!);
    const draftId = await addEntry("PURGE001", ids.a!, setA, { childName: "Purge Me" });
    const otherId = await addEntry("PURGE002", ids.a!, setA, { childName: "Other Child" });
    const keyA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await sql("INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at) VALUES (?, ?, 'video/mp4', 200000, 'issued', ?)", [draftId, keyA, new Date(Date.now() + 3_600_000)]);
    await sql("INSERT INTO duplicate_reviews (event_id, submission_id, matched_submission_id, status, reason) VALUES (?, ?, ?, 'flagged', 'similar_name')", [ids.a!, draftId, otherId]);
    const url = "/api/v1/admin/registrations/PURGE001/permanent";

    // not soft-deleted yet, wrong roles
    expect((await mutate(url, "DELETE", boss)).status).toBe(404);
    expect((await mutate("/api/v1/admin/registrations/PURGE001", "DELETE", boss)).status).toBe(200); // soft delete first
    expect((await mutate(url, "DELETE", admin)).status).toBe(403);
    expect((await mutate(url, "DELETE", judge)).status).toBe(403);
    expect((await mutate(url, "DELETE", null)).status).toBe(401);
    expect(await scalar("SELECT COUNT(*) AS n FROM submissions WHERE id = ?", [draftId])).toBe(1);

    // storage failure: nothing is deleted
    bucket.fail = true;
    expect((await mutate(url, "DELETE", boss)).status).toBe(502);
    bucket.fail = false;
    expect(await scalar("SELECT COUNT(*) AS n FROM submissions WHERE id = ?", [draftId])).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM video_uploads WHERE submission_id = ?", [draftId])).toBe(1);

    // success: stored objects first, then every row of that draft; the other entry is untouched
    const ok = await mutate(url, "DELETE", boss);
    expect(ok.status).toBe(200);
    expect(bucket.removed).toEqual([`pending/${keyA}`, `videos/${keyA}`]);
    for (const table of ["submissions WHERE id", "video_uploads WHERE submission_id", "duplicate_reviews WHERE submission_id", "entry_answers WHERE submission_id", "registration_recovery WHERE submission_id", "email_outbox WHERE submission_id"]) {
      expect(await scalar(`SELECT COUNT(*) AS n FROM ${table} = ?`, [draftId]), table).toBe(0);
    }
    expect(await scalar("SELECT COUNT(*) AS n FROM submissions WHERE id = ?", [otherId])).toBe(1);
    const audit = (await sql<{ details: unknown }>("SELECT details FROM audit_log WHERE action = 'registration.purged' AND entity_id = ?", [String(draftId)])).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.details)).not.toMatch(/Purge Me|Parent Person|parent@example/);
    expect((await mutate(url, "DELETE", boss)).status).toBe(404); // already gone: repeating is harmless
  });

  it("refuses to purge a protected or depended-on entry even when it is marked deleted", async () => {
    const boss = await signIn("super_admin");
    const live = Number((await sql<{ id: number }>("SELECT id FROM question_sets WHERE event_id = ? AND status = 'published'", [ids.a!])).rows[0]!.id);
    const withdrawn = await addEntry("PURGE003", ids.a!, live, { status: "withdrawn" });
    await sql("UPDATE submissions SET deleted_at = ? WHERE id = ?", [now(), withdrawn]);
    expect((await mutate("/api/v1/admin/registrations/PURGE003/permanent", "DELETE", boss)).status).toBe(409); // not a draft
    const pointed = await addEntry("PURGE004", ids.a!, live);
    const pointer = await addEntry("PURGE005", ids.a!, live);
    await sql("INSERT INTO duplicate_reviews (event_id, submission_id, matched_submission_id, status, reason) VALUES (?, ?, ?, 'flagged', 'similar_name')", [ids.a!, pointer, pointed]);
    await sql("UPDATE submissions SET deleted_at = ? WHERE id = ?", [now(), pointed]);
    expect((await mutate("/api/v1/admin/registrations/PURGE004/permanent", "DELETE", boss)).status).toBe(409); // another entry's review points at it
    expect(await scalar("SELECT COUNT(*) AS n FROM submissions WHERE id IN (?, ?)", [withdrawn, pointed])).toBe(2);
  });

  it("lets an administrator watch an entry's video through a five-minute signed link, audited, never to a judge or anonymous caller", async () => {
    const admin = await signIn("admin");
    const boss = await signIn("super_admin");
    const judge = await signIn("judge");
    const setA = Number((await sql<{ id: number }>("SELECT id FROM question_sets WHERE event_id = ? AND status = 'published'", [ids.a!])).rows[0]!.id);
    const withVideo = await addEntry("WATCH001", ids.a!, setA);
    const noVideo = await addEntry("WATCH002", ids.a!, setA);
    const key = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await sql("INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at, verified_at, verified_bytes) VALUES (?, ?, 'video/mp4', 200000, 'verified', ?, ?, 200000)", [withVideo, key, new Date(Date.now() + 3_600_000), now()]);
    const url = (code: string) => `/api/v1/admin/registrations/${code}/video/playback`;

    expect((await mutate(url("WATCH001"), "POST", null)).status).toBe(401);
    expect((await mutate(url("WATCH001"), "POST", judge)).status).toBe(403);
    expect((await mutate(url("WATCH002"), "POST", admin)).status).toBe(404); // no verified video
    expect((await mutate(url("NOSUCH99"), "POST", admin)).status).toBe(404);
    expect(bucket.signed).toEqual([]);

    for (const who of [admin, boss]) {
      const ok = await mutate(url("WATCH001"), "POST", who);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ ok: true, expiresInSeconds: 300, url: `https://bucket.test/videos/${key}?sig=1` });
    }
    expect(bucket.signed).toEqual([{ key: `videos/${key}`, seconds: 300 }, { key: `videos/${key}`, seconds: 300 }]);
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'registration.video_playback' AND entity_id = ?", [String(withVideo)])).toBe(2);

    // a deleted entry's video is not reachable
    await sql("UPDATE submissions SET deleted_at = ? WHERE id = ?", [now(), withVideo]);
    expect((await mutate(url("WATCH001"), "POST", admin)).status).toBe(404);
    expect(noVideo).toBeGreaterThan(0);
  });
});
