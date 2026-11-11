import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import type { DatabaseAdapter, Dialect, Queryable } from "../db/adapter.ts";
import { dialects, openTestDatabase } from "../db/test-db.ts";
import { dropAppSchema, installAppSchema } from "../db/test-schema.ts";
import { mintPlaybackUrl, PLAYBACK_SECONDS } from "../judge/entries.ts";
import { pendingKey, videoKey, type ObjectHead, type VideoStore } from "../storage/r2.ts";
import { captureLogger, listen, testConfig } from "../test-helpers.ts";
import { MAX_VIDEO_BYTES, MIN_VIDEO_BYTES, UPLOAD_URL_SECONDS } from "./video.ts";

// The parent's one video, end to end through the real app and database, with a fake bucket standing in for R2. The owner's rules (2026-11-11):
// at most 50 MB, a 10-minute upload URL, a single PUT, and ONE video per entry that cannot be replaced once attached.

const SITE = "http://site.test";
const TRACKING = "zz_video_migrations";
const HOUR = 3_600_000;
const MB = 1024 * 1024;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Reply = { status: number; body: Json; text: string; cookie: string | null };
type Session = { cookie: string; csrf: string; reference: string };

// A minimal MP4 (ftyp, moov with a movie header and a video track, mdat): enough for the inspector to read its declared length.
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const text = (t: string) => Uint8Array.from([...t].map((c) => c.charCodeAt(0)));
const be = (n: number, len: number) => Uint8Array.from({ length: len }, (_, i) => Math.floor(n / 256 ** (len - 1 - i)) % 256);
const box = (type: string, ...body: Uint8Array[]) => {
  const payload = cat(...body);
  return cat(be(8 + payload.length, 4), text(type), payload);
};
const mp4 = (seconds: number, bytes: number) => {
  const mvhd = box("mvhd", Uint8Array.of(0, 0, 0, 0), be(0, 4), be(0, 4), be(1000, 4), be(seconds * 1000, 4), new Uint8Array(80));
  const trak = box("trak", box("mdia", box("hdlr", new Uint8Array(8), text("vide"), new Uint8Array(12))));
  const head = cat(box("ftyp", text("isom"), be(0, 4), text("isom")), box("moov", mvhd, trak));
  return cat(head, box("mdat", new Uint8Array(bytes - head.length - 8)));
};

/** An in-memory bucket. A test "uploads" by putting an object at the presigned key, as the browser's PUT would. */
function fakeBucket() {
  const objects = new Map<string, ObjectHead & { data?: Uint8Array }>();
  let n = 0;
  const signed: { put: { key: string; contentType: string; seconds: number }[]; get: { key: string; seconds: number }[] } = { put: [], get: [] };
  const store: VideoStore = {
    async presignPut(key, { contentType, expiresInSeconds }) {
      signed.put.push({ key, contentType, seconds: expiresInSeconds });
      return `https://bucket.test/${key}?signature=x`;
    },
    async presignGet(key, { expiresInSeconds }) {
      signed.get.push({ key, seconds: expiresInSeconds });
      return `https://bucket.test/${key}?signature=y`;
    },
    async head(key) {
      return objects.get(key) ?? null;
    },
    async copy(from, to, etag) {
      const source = objects.get(from);
      if (!source || source.etag !== etag) throw new Error("PreconditionFailed");
      objects.set(to, { ...source });
    },
    async remove(key) {
      objects.delete(key);
    },
    async readRange(key, start, end) {
      const data = objects.get(key)?.data ?? new Uint8Array(0);
      return data.slice(start, end + 1);
    },
  };
  const put = (id: string, bytes: number, contentType = "video/mp4", data?: Uint8Array) =>
    objects.set(pendingKey(id), { bytes, contentType, etag: `"e${++n}"`, ...(data ? { data } : {}) });
  return { store, objects, signed, put };
}

describe.each(dialects)("%s video upload", (dialect: Dialect) => {
  let db: DatabaseAdapter;
  let servers: Server[] = [];
  let base: string;
  let offBase: string;
  let noBucketBase: string;
  const bucket = fakeBucket();
  const clock = { t: Date.now() };
  const now = () => new Date(clock.t);
  const on = testConfig({ PUBLIC_ORIGINS: SITE, TRUST_PROXY_HOPS: "1", ARGON2_MEMORY_KIB: "1024", ARGON2_PASSES: "1", RIO_UPLOADS_ENABLED: "yes" });
  const off = testConfig({ PUBLIC_ORIGINS: SITE, TRUST_PROXY_HOPS: "1", ARGON2_MEMORY_KIB: "1024", ARGON2_PASSES: "1", RIO_UPLOADS_ENABLED: "no" });
  let counter = 0;
  const sql = <Row = Record<string, unknown>>(text: string, params: readonly (string | number | Date | null)[] = []) => db.query<Row>(text, params);
  const scalar = async (text: string, params: readonly (string | number | Date | null)[] = []) => Number((await sql<{ n: number }>(text, params)).rows[0]!.n);

  async function start(config = on, video: VideoStore | null = bucket.store): Promise<string> {
    const server = createServer(createApp({ config, logger: captureLogger().logger, state: { shuttingDown: false }, db, now, video }));
    servers.push(server);
    return listen(server);
  }
  const openRegistration = (over: { open?: number; close?: number } = {}) =>
    sql("UPDATE event_settings SET submissions_open_at = ?, submissions_close_at = ?, guardian_consent_version = 'v1', media_consent_version = 'm1' WHERE id = 1", [new Date(clock.t + (over.open ?? -HOUR)), new Date(clock.t + (over.close ?? 60 * 24 * HOUR))]);

  beforeAll(async () => {
    db = openTestDatabase(dialect);
    await installAppSchema(db, TRACKING);
    await sql("INSERT INTO events (slug, name_ta, name_en, min_age, max_age, active, display_order) VALUES ('malalai-mozhi', 'மழலை மொழி', 'Toddler Tamil', 3, 12, 1, 1)");
    const eventId = Number((await sql<{ id: number }>("SELECT id FROM events WHERE slug = 'malalai-mozhi'")).rows[0]!.id);
    await sql("INSERT INTO question_sets (event_id, version) VALUES (?, 1)", [eventId]);
    await sql("UPDATE question_sets SET status = 'published', published_at = ? WHERE event_id = ?", [now(), eventId]);
    await sql("INSERT INTO events (slug, name_ta, name_en, min_age, max_age, active, display_order) VALUES ('kathai', 'கதை', 'Stories', 3, 12, 1, 2)");
    const second = Number((await sql<{ id: number }>("SELECT id FROM events WHERE slug = 'kathai'")).rows[0]!.id);
    await sql("INSERT INTO question_sets (event_id, version) VALUES (?, 1)", [second]);
    const setId = Number((await sql<{ id: number }>("SELECT id FROM question_sets WHERE event_id = ?", [second])).rows[0]!.id);
    await sql("INSERT INTO questions (question_set_id, position, question_key, type, prompt_ta, prompt_en, required) VALUES (?, 1, 'school', 'short_text', 'பள்ளி', 'School', 1)", [setId]);
    await sql("UPDATE question_sets SET status = 'published', published_at = ? WHERE id = ?", [now(), setId]);
    base = await start();
    offBase = await start(off);
    noBucketBase = await start(on, null);
  }, 120_000);
  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((resolve) => (s.closeAllConnections(), s.close(resolve)))));
    servers = [];
    await dropAppSchema(db, TRACKING);
    await db.close();
  });
  beforeEach(() => openRegistration());

  async function call(path: string, o: { method?: string; body?: unknown; cookie?: string | null; csrf?: string | null; origin?: string | null; at?: string } = {}): Promise<Reply> {
    const method = o.method ?? "GET";
    const sends = method !== "GET";
    const headers: Record<string, string> = { "x-forwarded-for": `10.4.${++counter % 250}.${(counter * 7) % 250}` };
    if (sends) headers["content-type"] = "application/json";
    if (sends && o.origin !== null) headers.origin = o.origin ?? SITE;
    if (o.cookie) headers.cookie = o.cookie;
    if (o.csrf) headers["x-csrf-token"] = o.csrf;
    const res = await fetch((o.at ?? base) + path, { method, headers, ...(sends ? { body: JSON.stringify(o.body ?? {}) } : {}) });
    const text = await res.text();
    const set = res.headers.getSetCookie().find((c) => c.startsWith("rio_reg=")) ?? null;
    return { status: res.status, body: text ? (JSON.parse(text) as Json) : {}, text, cookie: set ? set.split(";")[0]! : null };
  }
  async function register(o: { event?: string; mobile?: string } = {}): Promise<Session> {
    const r = await call("/api/v1/registrations", {
      method: "POST",
      body: {
        eventSlug: o.event ?? "malalai-mozhi", childName: "Asha Kumar", childAge: 6, guardianName: "Priya Kumar",
        guardianMobile: o.mobile ?? `9${String(10_000_000 + ++counter).padStart(9, "0")}`, guardianConsent: { accepted: true, version: "v1" },
      },
    });
    expect(r.status, r.text).toBe(201);
    return { cookie: r.cookie!, csrf: r.body.csrfToken as string, reference: r.body.reference as string };
  }
  const begin = (s: Session, body: unknown = { type: "video/mp4", bytes: 20 * MB }, o: { at?: string; csrf?: string | null; origin?: string | null; cookie?: string | null } = {}) =>
    call("/api/v1/registrations/current/video-uploads", { method: "POST", cookie: s.cookie, csrf: s.csrf, body, ...o });
  const complete = (s: Session, id: string, o: { at?: string } = {}) => call(`/api/v1/registrations/current/video-uploads/${id}/complete`, { method: "POST", cookie: s.cookie, csrf: s.csrf, ...o });
  const submissionOf = async (s: Session) => Number((await sql<{ id: number }>("SELECT id FROM submissions WHERE entry_code = ?", [s.reference])).rows[0]!.id);
  const uploadsOf = async (s: Session) => (await sql<{ status: string; object_key: string }>("SELECT status, object_key FROM video_uploads WHERE submission_id = ? ORDER BY id", [await submissionOf(s)])).rows;
  async function uploaded(s: Session, bytes = 20 * MB, seconds = 45): Promise<string> {
    const started = await begin(s, { type: "video/mp4", bytes });
    expect(started.status, started.text).toBe(201);
    const id = started.body.upload.uploadId as string;
    bucket.put(id, bytes, "video/mp4", mp4(seconds, bytes));
    const done = await complete(s, id);
    expect(done.status, done.text).toBe(200);
    return id;
  }

  describe("whether uploads are offered", () => {
    it("says so in the public settings only when registration is open, the switch is on and the bucket is configured", async () => {
      expect((await call("/api/v1/settings/public")).body.videoUploads).toBe(true);
      expect((await call("/api/v1/settings/public", { at: offBase })).body.videoUploads).toBe(false);
      expect((await call("/api/v1/settings/public", { at: noBucketBase })).body.videoUploads).toBe(false);
      await openRegistration({ open: -2 * HOUR, close: -HOUR });
      expect((await call("/api/v1/settings/public")).body.videoUploads).toBe(false);
    });

    it("refuses to start an upload with the switch off or no bucket (503), and records nothing", async () => {
      const s = await register();
      for (const at of [offBase, noBucketBase]) {
        const r = await begin(s, undefined, { at });
        expect(r.status).toBe(503);
        expect(r.body.error.code).toBe("uploads_unavailable");
      }
      expect(await uploadsOf(s)).toEqual([]);
    });
  });

  describe("starting an upload", () => {
    it("signs a 10-minute PUT for pending/<random id> with the declared type, and answers with no bucket detail but the URL", async () => {
      const s = await register();
      const r = await begin(s, { type: "video/quicktime", bytes: 30 * MB });
      expect(r.status, r.text).toBe(201);
      const { uploadId, url, contentType, expiresAt } = r.body.upload;
      expect(uploadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(url).toBe(`https://bucket.test/pending/${uploadId}?signature=x`);
      expect(contentType).toBe("video/quicktime");
      expect(new Date(expiresAt).getTime()).toBe(clock.t + 10 * 60_000);
      expect(bucket.signed.put.at(-1)).toEqual({ key: pendingKey(uploadId), contentType: "video/quicktime", seconds: 600 });
      expect(UPLOAD_URL_SECONDS).toBe(600);
      expect(r.text).not.toMatch(/Asha|Priya|R2_|secret/i);
      expect(await uploadsOf(s)).toEqual([{ status: "issued", object_key: uploadId }]);
    });

    it.each([
      ["over 50 MB", { type: "video/mp4", bytes: 50 * MB + 1 }, "bytes", "too_big"],
      ["exactly 100 MB (the old limit)", { type: "video/mp4", bytes: 100 * MB }, "bytes", "too_big"],
      ["zero bytes", { type: "video/mp4", bytes: 0 }, "bytes", "too_small"],
      ["below the minimum", { type: "video/mp4", bytes: MIN_VIDEO_BYTES - 1 }, "bytes", "too_small"],
      ["not a video type", { type: "image/png", bytes: 20 * MB }, "type", "unsupported_type"],
      ["a fractional size", { type: "video/mp4", bytes: 1.5 * MB + 0.5 }, "bytes", "invalid"],
    ])("refuses %s with a field code (422)", async (_label, body, field, problem) => {
      const s = await register();
      const r = await begin(s, body);
      expect(r.status, r.text).toBe(422);
      expect(r.body.error.fields).toContainEqual({ field, problem });
      expect(await uploadsOf(s)).toEqual([]);
    });

    it("accepts exactly 50 MB", async () => {
      expect(MAX_VIDEO_BYTES).toBe(50 * MB);
      expect((await begin(await register(), { type: "video/webm", bytes: 50 * MB })).status).toBe(201);
    });

    it("needs the entry's cookie, its CSRF token and the website's origin", async () => {
      const s = await register();
      expect((await begin(s, undefined, { cookie: null })).status).toBe(401);
      expect((await begin(s, undefined, { csrf: null })).status).toBe(403);
      expect((await begin(s, undefined, { csrf: "wrong" })).status).toBe(403);
      expect((await begin(s, undefined, { origin: "http://evil.test" })).status).toBe(403);
      expect(await uploadsOf(s)).toEqual([]);
    });

    it("refuses outside the registration window and for an entry that is no longer a draft", async () => {
      const s = await register();
      await openRegistration({ open: -2 * HOUR, close: -HOUR });
      expect((await begin(s)).body.error.code).toBe("registration_closed");
      await openRegistration();
      await sql("UPDATE submissions SET status = 'withdrawn', withdrawn_at = ? WHERE id = ?", [now(), await submissionOf(s)]);
      const r = await begin(s);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("not_editable");
    });
  });

  describe("completing an upload", () => {
    it("checks the stored object, copies it out of pending/, attaches it once and audits without personal data", async () => {
      const s = await register();
      const id = await uploaded(s, 12 * MB);
      expect(bucket.objects.has(videoKey(id))).toBe(true);
      expect(bucket.objects.has(pendingKey(id))).toBe(false);
      const view = (await call("/api/v1/registrations/current", { cookie: s.cookie })).body.registration;
      expect(view.video).toMatchObject({ uploaded: true, bytes: 12 * MB, contentType: "video/mp4" });
      expect(JSON.stringify(view)).not.toContain(id); // the parent never sees an object key
      expect(await uploadsOf(s)).toEqual([{ status: "verified", object_key: id }]);
      const audit = JSON.stringify((await sql("SELECT action, details FROM audit_log WHERE entity_id = ? AND action LIKE 'registration.video%'", [String(await submissionOf(s))])).rows);
      expect(audit).toContain("registration.video_upload_started");
      expect(audit).toContain("registration.video_uploaded");
      expect(audit).not.toMatch(/Asha|Priya|pending|videos|bucket/);
      expect(audit).not.toContain(id);
    });

    it("ONE video, final: once attached, a new upload is refused and the video stays the same", async () => {
      const s = await register();
      const id = await uploaded(s);
      const again = await begin(s);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("video_already_uploaded");
      expect(await uploadsOf(s)).toEqual([{ status: "verified", object_key: id }]);
      // completing the same upload twice is harmless and changes nothing
      expect((await complete(s, id)).status).toBe(200);
      expect(await scalar("SELECT COUNT(*) AS n FROM video_uploads WHERE submission_id = ? AND status = 'verified'", [await submissionOf(s)])).toBe(1);
    });

    it("an interrupted upload can be started again; the earlier URL is given up and can no longer attach anything", async () => {
      const s = await register();
      const first = (await begin(s)).body.upload.uploadId as string;
      const second = (await begin(s)).body.upload.uploadId as string;
      expect(await uploadsOf(s)).toEqual([{ status: "abandoned", object_key: first }, { status: "issued", object_key: second }]);
      bucket.put(first, 20 * MB);
      const stale = await complete(s, first);
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe("upload_not_current");
      bucket.put(second, 20 * MB);
      expect((await complete(s, second)).status).toBe(200);
    });

    it("says the video has not arrived when nothing was stored, and lets the parent finish later", async () => {
      const s = await register();
      const id = (await begin(s)).body.upload.uploadId as string;
      const early = await complete(s, id);
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe("upload_missing");
      expect(await uploadsOf(s)).toEqual([{ status: "issued", object_key: id }]);
      bucket.put(id, 20 * MB);
      expect((await complete(s, id)).status).toBe(200);
    });

    it.each([
      ["a different size than declared", 21 * MB, "video/mp4", "mismatch"],
      ["a different type than declared", 20 * MB, "video/webm", "mismatch"],
      ["more than 50 MB actually stored", 50 * MB + 1, "video/mp4", "too_big"],
    ])("rejects %s, removes the object and keeps the entry without a video", async (_label, bytes, type, problem) => {
      const s = await register();
      const id = (await begin(s, { type: "video/mp4", bytes: 20 * MB })).body.upload.uploadId as string;
      bucket.put(id, bytes, type);
      const r = await complete(s, id);
      expect(r.status).toBe(422);
      expect(r.body.error.fields).toContainEqual({ field: "video", problem });
      expect(bucket.objects.has(pendingKey(id))).toBe(false);
      expect(bucket.objects.has(videoKey(id))).toBe(false);
      expect(await uploadsOf(s)).toEqual([{ status: "rejected", object_key: id }]);
    });

    it("another parent's upload id is simply not found, and nothing of theirs changes", async () => {
      const a = await register();
      const b = await register();
      const id = (await begin(a)).body.upload.uploadId as string;
      bucket.put(id, 20 * MB);
      const r = await complete(b, id);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("upload_not_found");
      expect(await uploadsOf(a)).toEqual([{ status: "issued", object_key: id }]);
      expect(await uploadsOf(b)).toEqual([]);
      expect((await complete(a, "not-a-uuid")).status).toBe(404);
    });

    it("an upload reported long after its URL expired is refused and must be started again", async () => {
      const s = await register();
      const id = (await begin(s)).body.upload.uploadId as string;
      bucket.put(id, 20 * MB);
      clock.t += 26 * 60_000; // 10 minutes of URL + 15 minutes of grace, and a bit
      try {
        await openRegistration();
        const r = await complete(s, id);
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe("upload_expired");
        expect(await uploadsOf(s)).toEqual([{ status: "abandoned", object_key: id }]);
        const fresh = (await begin(s)).body.upload.uploadId as string;
        bucket.put(fresh, 20 * MB);
        expect((await complete(s, fresh)).status).toBe(200);
      } finally {
        clock.t -= 26 * 60_000;
      }
    });

    it("the database alone refuses a second checked video for one entry", async () => {
      const s = await register();
      await uploaded(s);
      const sub = await submissionOf(s);
      await sql("INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, expires_at) VALUES (?, ?, 'video/mp4', 200000, 'issued', ?)", [sub, "00000000-0000-4000-8000-000000000001", new Date(clock.t + HOUR)]);
      await expect(sql("UPDATE video_uploads SET status = 'verified', verified_at = ?, verified_bytes = 200000 WHERE object_key = ?", [now(), "00000000-0000-4000-8000-000000000001"])).rejects.toMatchObject({ kind: "constraint", constraint: "unique" });
    });
  });

  describe("judge playback", () => {
    // The assignment check and the audit row are covered by the judging suite; this pins the URL itself.
    const oneRow: Queryable = {
      dialect: "sqlite",
      async query(text: string) {
        return (text.includes("SELECT") ? { rows: [{ id: 7, object_key: "11111111-2222-4333-8444-555555555555" }], affectedRows: 0 } : { rows: [], affectedRows: 1 }) as never;
      },
    } as Queryable;

    it("is a five-minute presigned GET of the checked copy in the private bucket, never a public or made-up address", async () => {
      const r = await mintPlaybackUrl(oneRow, now(), { judgeId: 1, requestId: "req" }, "RIO00001", bucket.store);
      expect(PLAYBACK_SECONDS).toBe(300);
      expect(r).toEqual({ ok: true, url: "https://bucket.test/videos/11111111-2222-4333-8444-555555555555?signature=y", expiresInSeconds: 300 });
      expect(bucket.signed.get.at(-1)).toEqual({ key: "videos/11111111-2222-4333-8444-555555555555", seconds: 300 });
    });

    it("answers 503 when the bucket is not configured", async () => {
      await expect(mintPlaybackUrl(oneRow, now(), { judgeId: 1, requestId: "req" }, "RIO00001", null)).rejects.toMatchObject({ status: 503, code: "playback_unavailable" });
    });
  });

  describe("final submission (details, then the video, then submit)", () => {
    const submit = (s: Session, body: unknown = { confirm: true }, o: { at?: string } = {}) =>
      call("/api/v1/registrations/current/submit", { method: "POST", cookie: s.cookie, csrf: s.csrf, body, ...o });
    const statusOf = async (s: Session) =>
      (await sql<{ status: string; finalized_at: unknown }>("SELECT status, finalized_at FROM submissions WHERE entry_code = ?", [s.reference])).rows[0]!;

    it("finalizes a complete entry, freezes it, audits without personal data, and a repeated press is harmless", async () => {
      const s = await register();
      await uploaded(s, 2 * MB, 45);
      const r = await submit(s);
      expect(r.status, r.text).toBe(200);
      expect(r.body.registration).toMatchObject({ status: "finalized", editable: false, video: { uploaded: true } });
      expect((await statusOf(s)).status).toBe("finalized");
      expect((await statusOf(s)).finalized_at).not.toBeNull();
      expect((await submit(s)).status).toBe(200);
      // frozen: no edit, no new video
      const edit = await call("/api/v1/registrations/current", { method: "PATCH", cookie: s.cookie, csrf: s.csrf, body: { childName: "Changed Name" } });
      expect(edit.body.error.code).toBe("not_editable");
      expect((await begin(s)).body.error.code).toBe("not_editable");
      const audit = JSON.stringify((await sql("SELECT action, details FROM audit_log WHERE action = 'registration.submitted' AND entity_id = ?", [String(await submissionOf(s))])).rows);
      expect(audit).toContain("finalized");
      expect(audit).not.toMatch(/Asha|Priya|videos|pending/);
    });

    it("needs an explicit confirm", async () => {
      const s = await register();
      await uploaded(s, 2 * MB);
      const r = await submit(s, {});
      expect(r.status).toBe(422);
      expect(r.body.error.fields).toContainEqual({ field: "confirm", problem: "confirm_required" });
      expect((await statusOf(s)).status).toBe("draft");
    });

    it("refuses without a video, without consent, and with a required question unanswered, naming what is missing", async () => {
      const noVideo = await register();
      const r1 = await submit(noVideo);
      expect(r1.status).toBe(409);
      expect(r1.body.error.code).toBe("video_required");

      const noConsent = await register();
      await uploaded(noConsent, 2 * MB);
      await sql("UPDATE submissions SET guardian_consent_version = NULL, guardian_consent_at = NULL WHERE id = ?", [await submissionOf(noConsent)]);
      const r2 = await submit(noConsent);
      expect(r2.status).toBe(422);
      expect(r2.body.error.fields).toContainEqual({ field: "guardianConsent", problem: "required" });

      const unanswered = await register({ event: "kathai" });
      await uploaded(unanswered, 2 * MB);
      const r3 = await submit(unanswered);
      expect(r3.status).toBe(422);
      expect(r3.body.error.fields).toContainEqual({ field: "answers.school", problem: "required" });
      for (const s of [noVideo, noConsent, unanswered]) expect((await statusOf(s)).status).toBe("draft");
    });

    it.each([
      ["shorter than 30 seconds", 20, "too_short"],
      ["longer than 90 seconds", 120, "too_long"],
    ])("a video %s is refused at submission and removed, so the parent can upload a correct one", async (_label, seconds, problem) => {
      const s = await register();
      const id = await uploaded(s, 2 * MB, seconds);
      const r = await submit(s);
      expect(r.status).toBe(422);
      expect(r.body.error.fields).toContainEqual({ field: "video", problem });
      expect(await uploadsOf(s)).toEqual([{ status: "deleted", object_key: id }]);
      expect(bucket.objects.has(videoKey(id))).toBe(false);
      expect((await statusOf(s)).status).toBe("draft");
      await uploaded(s, 2 * MB, 60);
      expect((await submit(s)).status).toBe(200);
    });

    it("a stored video that changed after it was checked is not submitted; the parent may try again", async () => {
      const s = await register();
      const id = await uploaded(s, 2 * MB);
      bucket.objects.set(videoKey(id), { ...bucket.objects.get(videoKey(id))!, etag: "tampered" });
      const r = await submit(s);
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe("submission_unavailable");
      expect((await statusOf(s)).status).toBe("draft");
      expect(await uploadsOf(s)).toEqual([{ status: "verified", object_key: id }]);
    });

    it("a second entry for the same child, mobile and competition is held for review, and the parent is told nothing different", async () => {
      const mobile = "9876500001";
      const first = await register({ mobile });
      await uploaded(first, 2 * MB);
      expect((await submit(first)).body.registration.status).toBe("finalized");
      const second = await register({ mobile });
      await uploaded(second, 2 * MB);
      const r = await submit(second);
      expect(r.status).toBe(200);
      expect(r.body.registration.status).toBe("held");
      expect(await scalar("SELECT COUNT(*) AS n FROM duplicate_reviews WHERE submission_id = ? AND status IN ('held', 'flagged')", [await submissionOf(second)])).toBe(1);
      expect(await scalar("SELECT COUNT(*) AS n FROM submissions WHERE guardian_mobile = ? AND status = 'finalized'", [`+91${mobile}`])).toBe(1);
    });

    it("refuses outside the window and when uploads are off", async () => {
      const s = await register();
      await uploaded(s, 2 * MB);
      expect((await submit(s, undefined, { at: offBase })).body.error.code).toBe("submission_unavailable");
      await openRegistration({ open: -2 * HOUR, close: -HOUR });
      expect((await submit(s)).body.error.code).toBe("registration_closed");
      await openRegistration();
      expect((await submit(s)).status).toBe(200);
    });
  });
});
