import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { hashPassword } from "../auth/password.ts";
import type { DatabaseAdapter, Dialect } from "../db/adapter.ts";
import { dialects, openTestDatabase } from "../db/test-db.ts";
import { dropAppSchema, installAppSchema } from "../db/test-schema.ts";
import { captureLogger, listen, testConfig } from "../test-helpers.ts";

// The question builder end to end: real HTTP, the real Express app, a disposable database (in-memory SQLite always; a *_test MySQL/MariaDB
// database when RIO_TEST_DATABASE_URL is set). Nothing here touches rio_hospital.

const ORIGIN = "http://admin.test";
const COST = { memoryKib: 1024, passes: 1 };
const TRACKING = "zz_questions_migrations";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Reply = { status: number; body: Json; text: string };
type Who = { cookie: string; csrf: string; id: number };

const TA = { prompt: "உங்கள் குழந்தை என்ன விரும்புகிறது?", en: "What does your child like?", opt1: "கதைகள்", opt2: "பாடல்கள்", opt3: "ஓவியம்" };
const short = (over: Json = {}) => ({ type: "short_text", promptTa: TA.prompt, promptEn: TA.en, ...over });
const choice = (type: string, over: Json = {}) => ({
  type, promptTa: "தேர்ந்தெடுக்கவும்", promptEn: "Choose", options: [{ ta: TA.opt1, en: "Stories" }, { ta: TA.opt2, en: "Songs" }, { ta: TA.opt3, en: "Drawing" }], ...over,
});

describe.each(dialects)("%s question builder", (dialect: Dialect) => {
  let db: DatabaseAdapter;
  let server: Server;
  let base: string;
  let admin: Who;
  let judge: Who;
  let counter = 0;
  const config = testConfig({ ALLOWED_ORIGINS: ORIGIN, PUBLIC_ORIGINS: "http://site.test", TRUST_PROXY_HOPS: "1", ARGON2_MEMORY_KIB: String(COST.memoryKib), ARGON2_PASSES: String(COST.passes) });
  const sql = <Row = Record<string, unknown>>(text: string, params: readonly (string | number | Date | null)[] = []) => db.query<Row>(text, params);
  const scalar = async (text: string, params: readonly (string | number | Date | null)[] = []) => Number((await sql<{ n: number }>(text, params)).rows[0]!.n);
  const ev = {} as { alpha: number; beta: number } & Record<string, number>;

  async function call(path: string, o: { method?: string; body?: unknown; who?: Who | null; csrf?: string | null; origin?: string | null } = {}): Promise<Reply> {
    const method = o.method ?? "GET";
    const sends = method !== "GET" && method !== "DELETE";
    const headers: Record<string, string> = { "x-forwarded-for": `10.7.${++counter % 250}.${counter % 200}` };
    if (sends) headers["content-type"] = "application/json";
    if (o.origin !== null && method !== "GET") headers.origin = o.origin ?? ORIGIN;
    if (o.who) headers.cookie = o.who.cookie;
    const csrf = o.csrf === undefined ? o.who?.csrf : o.csrf;
    if (csrf) headers["x-csrf-token"] = csrf;
    const res = await fetch(base + path, { method, headers, ...(sends ? { body: JSON.stringify(o.body ?? {}) } : {}) });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Json) : {}, text };
  }
  async function signIn(role: "admin" | "judge"): Promise<Who> {
    const email = `${role}${++counter}@example.org`;
    const password = `Start-Pass-${counter}-xyz`;
    await sql("INSERT INTO staff_users (email, password_hash, role, display_name, active, must_change_password, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)", [email, await hashPassword(password, COST), role, "Staff", new Date()]);
    const id = Number((await sql<{ id: number }>("SELECT id FROM staff_users WHERE email = ?", [email])).rows[0]!.id);
    const res = await fetch(`${base}/api/v1/staff/login`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": `10.6.${counter % 250}.${counter % 200}` }, body: JSON.stringify({ email, password }) });
    const body = (await res.json()) as Json;
    return { cookie: res.headers.getSetCookie()[0]!.split(";")[0]!, csrf: body.csrfToken as string, id };
  }

  beforeAll(async () => {
    db = openTestDatabase(dialect);
    await installAppSchema(db, TRACKING);
    server = createServer(createApp({ config, logger: captureLogger().logger, state: { shuttingDown: false }, db }));
    base = await listen(server);
    for (const [slug, n] of [["alpha", 1], ["beta", 2]] as const) {
      await sql("INSERT INTO events (slug, name_ta, name_en, min_age, max_age, display_order) VALUES (?, ?, ?, 3, 12, ?)", [slug, `போட்டி ${n}`, `Contest ${n}`, n]);
      ev[slug] = Number((await sql<{ id: number }>("SELECT id FROM events WHERE slug = ?", [slug])).rows[0]!.id);
    }
    admin = await signIn("admin");
    judge = await signIn("judge");
  }, 120_000);
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await dropAppSchema(db, TRACKING);
    await db.close();
  });

  const P = (slug: string, setId?: number | string, rest = "") => `/api/v1/admin/competitions/${slug}/question-sets${setId === undefined ? "" : `/${setId}`}${rest}`;
  const A = (path: string, o: Parameters<typeof call>[1] = {}) => call(path, { who: admin, ...o });
  async function draft(slug: string, startFrom?: string): Promise<number> {
    const r = await A(P(slug), { method: "POST", body: startFrom ? { startFrom } : {} });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as number;
  }
  const add = (slug: string, setId: number, body: unknown) => A(P(slug, setId, "/questions"), { method: "POST", body });
  const detail = async (slug: string, setId: number) => (await A(P(slug, setId))).body;
  async function publish(slug: string, setId: number) {
    const r = await A(P(slug, setId, "/publish"), { method: "POST", body: { confirm: true } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  }
  const discardAll = async (slug: string) => {
    for (const s of (await A(P(slug))).body.sets as Json[]) if (s.status === "draft") await A(P(slug, s.id), { method: "DELETE" });
  };

  describe("access control", () => {
    it("refuses anonymous callers on every route (401), including drafts", async () => {
      const id = await draft("alpha");
      await add("alpha", id, short());
      for (const [method, path] of [["GET", "/api/v1/admin/competitions"], ["GET", P("alpha")], ["GET", P("alpha", id)], ["GET", P("alpha", id, "/preview")], ["POST", P("alpha")], ["POST", P("alpha", id, "/questions")], ["PUT", P("alpha", id, "/order")], ["DELETE", P("alpha", id)], ["POST", P("alpha", id, "/publish")]] as const) {
        const r = await call(path, { method, who: null, body: {} });
        expect(r.status, `${method} ${path}`).toBe(401);
        expect(r.text).not.toContain(TA.prompt);
      }
      await discardAll("alpha");
    });
    it("refuses a judge on every route (403) and changes nothing", async () => {
      const id = await draft("alpha");
      const before = await scalar("SELECT COUNT(*) AS n FROM audit_log");
      for (const [method, path] of [["GET", "/api/v1/admin/competitions"], ["GET", P("alpha")], ["GET", P("alpha", id)], ["GET", P("alpha", id, "/preview")], ["POST", P("alpha")], ["POST", P("alpha", id, "/questions")], ["PUT", P("alpha", id, "/order")], ["DELETE", P("alpha", id)], ["POST", P("alpha", id, "/publish")]] as const) {
        expect((await call(path, { method, who: judge, body: short() })).status, `${method} ${path}`).toBe(403);
      }
      expect(await scalar("SELECT COUNT(*) AS n FROM audit_log")).toBe(before);
      expect(await scalar("SELECT COUNT(*) AS n FROM questions")).toBe(0);
      await discardAll("alpha");
    });
    it("refuses changes without the CSRF token or from another origin", async () => {
      const id = await draft("alpha");
      expect((await add("alpha", id, short()).then(() => call(P("alpha", id, "/questions"), { method: "POST", who: admin, csrf: null, body: short() }))).status).toBe(403);
      expect((await call(P("alpha", id, "/questions"), { method: "POST", who: admin, csrf: "wrong", body: short() })).status).toBe(403);
      expect((await call(P("alpha", id, "/questions"), { method: "POST", who: admin, origin: "http://evil.test", body: short() })).status).toBe(403);
      expect((await call(P("alpha", id, "/publish"), { method: "POST", who: admin, csrf: null, body: { confirm: true } })).status).toBe(403);
      expect(await scalar("SELECT COUNT(*) AS n FROM questions")).toBe(1);
      await discardAll("alpha");
    });
  });

  describe("a draft: every question type, Tamil text, order", () => {
    it("lists the competitions with no set at all, and creates a blank draft as version 1", async () => {
      const list = await A("/api/v1/admin/competitions");
      expect(list.body.competitions.map((c: Json) => [c.slug, c.published, c.draft])).toEqual([["alpha", null, null], ["beta", null, null]]);
      const id = await draft("alpha");
      const d = await detail("alpha", id);
      expect(d.set).toMatchObject({ version: 1, status: "draft", questionCount: 0, entryCount: 0 });
      expect((await A(P("alpha", undefined), { method: "POST" })).status).toBe(409); // one draft at a time
      expect((await A(P("alpha"), { method: "POST" })).body.error.code).toBe("draft_exists");
      await discardAll("alpha");
    });

    it("stores all seven types with Tamil and English text exactly, and numbers them in order", async () => {
      const id = await draft("alpha");
      const inputs = [
        short({ helpTa: "ஒரு வரி", helpEn: "One line", required: true, maxLength: 50 }),
        { type: "paragraph", promptTa: "விவரிக்கவும்", promptEn: "Describe", maxLength: 500 },
        choice("dropdown"),
        choice("radio", { required: true }),
        choice("checkboxes", { minChoices: 1, maxChoices: 2 }),
        { type: "number", promptTa: "வயது", promptEn: "Age", minNumber: 3, maxNumber: 12 },
        { type: "instruction", promptTa: "வீடியோவை ஒரு நிமிடத்தில் அனுப்புங்கள்", promptEn: "Send a one-minute video" },
      ];
      for (const body of inputs) expect((await add("alpha", id, body)).status).toBe(201);
      const d = await detail("alpha", id);
      expect(d.questions.map((q: Json) => [q.key, q.type, q.position])).toEqual([["q1", "short_text", 1], ["q2", "paragraph", 2], ["q3", "dropdown", 3], ["q4", "radio", 4], ["q5", "checkboxes", 5], ["q6", "number", 6], ["q7", "instruction", 7]]);
      expect(d.questions[0]).toMatchObject({ promptTa: TA.prompt, promptEn: TA.en, helpTa: "ஒரு வரி", helpEn: "One line", required: true, maxLength: 50, active: true });
      expect(d.questions[2].options).toEqual([{ code: "o1", ta: TA.opt1, en: "Stories" }, { code: "o2", ta: TA.opt2, en: "Songs" }, { code: "o3", ta: TA.opt3, en: "Drawing" }]);
      expect(d.questions[4]).toMatchObject({ minChoices: 1, maxChoices: 2 });
      expect(d.questions[5]).toMatchObject({ minNumber: 3, maxNumber: 12 });
      expect(d.questions[6]).toMatchObject({ required: false, options: null });
      expect(d.questions[0].promptTa).toBe(TA.prompt.normalize("NFC"));
      await discardAll("alpha");
    });

    it("updates a question (options added, edited, removed and reordered keep their codes), and refuses to change its type", async () => {
      const id = await draft("alpha");
      const q = (await add("alpha", id, choice("radio"))).body;
      const [o1, o2, o3] = q.options as [Json, Json, Json];
      const edited = await A(P("alpha", id, `/questions/${q.id}`), {
        method: "PATCH",
        body: choice("radio", { promptEn: "Pick one", options: [{ code: o3.code, ta: o3.ta, en: "Art" }, { code: o1.code, ta: o1.ta, en: o1.en }, { ta: "நடனம்", en: "Dance" }] }),
      });
      expect(edited.status).toBe(200);
      expect(edited.body.promptEn).toBe("Pick one");
      expect(edited.body.options).toEqual([{ code: o3.code, ta: o3.ta, en: "Art" }, { code: o1.code, ta: o1.ta, en: o1.en }, { code: "o2", ta: "நடனம்", en: "Dance" }]);
      expect(o2.code).toBe("o2"); // the removed option's code is reused only because it is no longer taken
      const type = await A(P("alpha", id, `/questions/${q.id}`), { method: "PATCH", body: short() });
      expect(type.status).toBe(422);
      expect(type.body.error.fields.type).toBe("type_cannot_change");
      await discardAll("alpha");
    });

    it("deletes a draft question and reorders the rest, refusing an order that is not exactly the questions", async () => {
      const id = await draft("alpha");
      const ids: number[] = [];
      for (const n of [1, 2, 3, 4]) ids.push((await add("alpha", id, short({ promptEn: `Q${n}` }))).body.id);
      expect((await A(P("alpha", id, `/questions/${ids[1]}`), { method: "DELETE" })).status).toBe(204);
      const order = [ids[3]!, ids[0]!, ids[2]!];
      const r = await A(P("alpha", id, "/order"), { method: "PUT", body: { order } });
      expect(r.status).toBe(200);
      expect(r.body.questions.map((q: Json) => [q.id, q.position])).toEqual([[order[0], 1], [order[1], 2], [order[2], 3]]);
      expect((await detail("alpha", id)).questions.map((q: Json) => q.promptEn)).toEqual(["Q4", "Q1", "Q3"]);
      for (const bad of [[ids[0]!], [ids[0]!, ids[0]!, ids[2]!], [ids[0]!, ids[2]!, ids[1]!], [ids[0]!, ids[2]!, 999999]]) {
        expect((await A(P("alpha", id, "/order"), { method: "PUT", body: { order: bad } })).status).toBe(422);
      }
      expect((await detail("alpha", id)).questions.map((q: Json) => q.promptEn)).toEqual(["Q4", "Q1", "Q3"]);
      await discardAll("alpha");
    });

    it("stops at 60 questions", async () => {
      const id = await draft("alpha");
      for (let i = 0; i < 60; i += 1) await sql("INSERT INTO questions (question_set_id, position, question_key, type, prompt_ta, prompt_en) VALUES (?, ?, ?, 'short_text', 'ஒன்று', 'One')", [id, i + 1, `q${i + 1}`]);
      const r = await add("alpha", id, short());
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("too_many_questions");
      await discardAll("alpha");
    });
  });

  describe("validation", () => {
    it.each([
      ["an empty Tamil label", short({ promptTa: "  " }), "promptTa"],
      ["an empty English label", short({ promptEn: "" }), "promptEn"],
      ["a label with markup", short({ promptEn: "<script>alert(1)</script>" }), "promptEn"],
      ["a description with an angle bracket", short({ helpTa: "a > b" }), "helpTa"],
      ["a label with a control character", short({ promptEn: "bad\u0007text" }), "promptEn"],
      ["a label over 500 characters", short({ promptEn: "x".repeat(501) }), "promptEn"],
      ["a choice question with one option", choice("radio", { options: [{ ta: "ஒன்று", en: "One" }] }), "options"],
      ["a choice question with no options", { type: "dropdown", promptTa: "அ", promptEn: "A" }, "options"],
      ["an option with an empty label", choice("radio", { options: [{ ta: "", en: "One" }, { ta: "இரண்டு", en: "Two" }] }), "options.0.ta"],
      ["two identical options", choice("radio", { options: [{ ta: "ஒன்று", en: "One" }, { ta: "ஒன்று", en: "One" }] }), "options"],
      ["two options with the same code", choice("radio", { options: [{ code: "a", ta: "ஒன்று", en: "One" }, { code: "a", ta: "இரண்டு", en: "Two" }] }), "options"],
      ["an option code with capitals", choice("radio", { options: [{ code: "ABC", ta: "ஒன்று", en: "One" }, { ta: "இரண்டு", en: "Two" }] }), "options.0.code"],
      ["more than 30 options", choice("radio", { options: Array.from({ length: 31 }, (_, i) => ({ ta: `விருப்பம் ${i}`, en: `Option ${i}` })) }), "options"],
      ["a minimum above the maximum", choice("checkboxes", { minChoices: 3, maxChoices: 2 }), "maxChoices"],
      ["a maximum above the number of options", choice("checkboxes", { maxChoices: 4 }), "maxChoices"],
      ["a minimum above the number of options", choice("checkboxes", { minChoices: 4 }), "minChoices"],
      ["a required checkbox question that allows none", choice("checkboxes", { required: true, minChoices: 0 }), "minChoices"],
      ["selection limits on a radio question", choice("radio", { minChoices: 1 }), "body"],
      ["a number minimum above its maximum", { type: "number", promptTa: "எண்", promptEn: "Number", minNumber: 10, maxNumber: 1 }, "maxNumber"],
      ["a number limit that is not finite", { type: "number", promptTa: "எண்", promptEn: "Number", minNumber: "1" }, "minNumber"],
      ["a required instruction", { type: "instruction", promptTa: "தகவல்", promptEn: "Info", required: true }, "required"],
      ["a text length limit of zero", short({ maxLength: 0 }), "maxLength"],
      ["a short-text length limit over 500", short({ maxLength: 501 }), "maxLength"],
      ["an unknown type", { type: "date", promptTa: "அ", promptEn: "A" }, "type"],
      ["an unknown field", short({ branchTo: "q2" }), "body"],
    ])("refuses %s with a field code and stores nothing", async (_name, body, field) => {
      const id = await draft("alpha");
      const r = await add("alpha", id, body);
      expect([400, 422]).toContain(r.status);
      expect(Object.keys(r.body.error.fields).some((k) => k === field || k.startsWith(field))).toBe(true);
      expect(JSON.stringify(r.body)).not.toContain("alert(1)");
      expect(await scalar("SELECT COUNT(*) AS n FROM questions WHERE question_set_id = ?", [id])).toBe(0);
      await discardAll("alpha");
    });
    it("cleans text: Unicode NFC, collapsed whitespace", async () => {
      const id = await draft("alpha");
      const decomposed = "கொ";
      const r = await add("alpha", id, short({ promptTa: `  ${decomposed}   ${decomposed}  `, promptEn: "  A \n  B " }));
      expect(r.body.promptEn).toBe("A B");
      expect(r.body.promptTa).toBe(`${decomposed.normalize("NFC")} ${decomposed.normalize("NFC")}`);
      await discardAll("alpha");
    });
    it("answers an unknown or malformed id with 404, never with a stack or SQL", async () => {
      for (const path of [P("alpha", 999999), P("alpha", "abc"), P("alpha", "0"), P("nope"), P("Alpha"), P("alpha", 1, "/questions/xyz")]) {
        const r = await A(path, { method: path.endsWith("xyz") ? "DELETE" : "GET" });
        expect(r.status, path).toBe(404);
        expect(r.text).not.toMatch(/SELECT|stack|at /);
      }
    });
  });

  describe("preview and publishing", () => {
    it("previews a draft the way a parent will see it (active questions only) and lists what blocks publishing", async () => {
      const id = await draft("alpha");
      let p = (await A(P("alpha", id, "/preview"))).body;
      expect(p.questions).toEqual([]);
      expect(p.problems.map((x: Json) => x.code)).toEqual(["no_active_questions"]);
      await add("alpha", id, { type: "instruction", promptTa: "தகவல்", promptEn: "Info" });
      p = (await A(P("alpha", id, "/preview"))).body;
      expect(p.problems.map((x: Json) => x.code)).toEqual(["only_instructions"]);
      await add("alpha", id, short());
      await add("alpha", id, short({ promptEn: "Hidden", active: false }));
      p = (await A(P("alpha", id, "/preview"))).body;
      expect(p.problems).toEqual([]);
      expect(p.questions.map((q: Json) => q.promptEn)).toEqual(["Info", TA.en]);
      expect(p.inactiveCount).toBe(1);
      expect(Object.keys(p.questions[1]).sort()).toEqual(["helpEn", "helpTa", "key", "maxChoices", "maxLength", "maxNumber", "minChoices", "minNumber", "options", "position", "promptEn", "promptTa", "required", "type"]);
      await discardAll("alpha");
    });

    it("never publishes by itself: publishing needs confirm = true and a publishable draft", async () => {
      const id = await draft("alpha");
      expect((await A(P("alpha", id, "/publish"), { method: "POST", body: {} })).status).toBe(400);
      expect((await A(P("alpha", id, "/publish"), { method: "POST", body: { confirm: false } })).status).toBe(400);
      const empty = await A(P("alpha", id, "/publish"), { method: "POST", body: { confirm: true } });
      expect(empty.status).toBe(422);
      expect(empty.body.error.code).toBe("not_publishable");
      expect((await detail("alpha", id)).set.status).toBe("draft");
      expect((await call("/api/v1/events")).body.events.find((e: Json) => e.slug === "alpha").questionSet).toBeNull();
      await discardAll("alpha");
    });
  });

  describe("versioning", () => {
    it("publishes, makes the set immutable, and keeps the public registration answer in step", async () => {
      const id = await draft("alpha");
      const q1 = (await add("alpha", id, short({ required: true }))).body;
      await add("alpha", id, choice("radio"));
      await add("alpha", id, short({ promptEn: "Parked", active: false }));
      const result = await publish("alpha", id);
      expect(result).toMatchObject({ id, version: 1, questions: 2, removedInactive: 1, retiredPrevious: 0 });
      const d = await detail("alpha", id);
      expect(d.set.status).toBe("published");
      expect(d.questions).toHaveLength(2);
      // through the API
      for (const r of [
        await add("alpha", id, short()),
        await A(P("alpha", id, `/questions/${q1.id}`), { method: "PATCH", body: short({ promptEn: "Changed" }) }),
        await A(P("alpha", id, `/questions/${q1.id}`), { method: "DELETE" }),
        await A(P("alpha", id, "/order"), { method: "PUT", body: { order: d.questions.map((q: Json) => q.id).reverse() } }),
        await A(P("alpha", id), { method: "DELETE" }),
        await A(P("alpha", id, "/publish"), { method: "POST", body: { confirm: true } }),
      ]) {
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe("not_a_draft");
      }
      // and straight through SQL: the database itself refuses
      await expect(sql("UPDATE questions SET prompt_en = 'x' WHERE id = ?", [q1.id])).rejects.toMatchObject({ kind: "constraint" });
      await expect(sql("DELETE FROM questions WHERE id = ?", [q1.id])).rejects.toMatchObject({ kind: "constraint" });
      await expect(sql("INSERT INTO questions (question_set_id, position, question_key, type, prompt_ta, prompt_en) VALUES (?, 9, 'q9', 'short_text', 'அ', 'A')", [id])).rejects.toMatchObject({ kind: "constraint" });
      await expect(sql("DELETE FROM question_sets WHERE id = ?", [id])).rejects.toMatchObject({ kind: "constraint" });
      // the parents' view now has the published questions, in the public shape
      const pub = (await call("/api/v1/events")).body.events.find((e: Json) => e.slug === "alpha");
      expect(pub.questionSet.version).toBe(1);
      expect(pub.questionSet.questions.map((q: Json) => q.key)).toEqual(["q1", "q2"]);
      expect(pub.questionSet.questions[0].promptTa).toBe(TA.prompt);
    });

    it("does not touch another competition", async () => {
      const list = (await A("/api/v1/admin/competitions")).body.competitions;
      expect(list.find((c: Json) => c.slug === "beta")).toMatchObject({ published: null, draft: null });
      expect(await scalar("SELECT COUNT(*) AS n FROM question_sets WHERE event_id = ?", [ev.beta])).toBe(0);
    });

    it("a revision starts as a copy of the published set (same keys and option codes), and publishing it retires the old one", async () => {
      const v1 = (await A(P("alpha"))).body.sets.find((s: Json) => s.status === "published");
      // an entry started against version 1, with an answer
      const v1q = (await detail("alpha", v1.id)).questions as Json[];
      await sql("INSERT INTO submissions (entry_code, event_id, question_set_id, status, child_name, child_name_norm, child_age, guardian_name, guardian_mobile, created_at, updated_at) VALUES ('RIO00001', ?, ?, 'draft', 'c', 'c', 5, 'g', '+919876543210', ?, ?)", [ev.alpha, v1.id, new Date(), new Date()]);
      const sub = Number((await sql<{ id: number }>("SELECT id FROM submissions WHERE entry_code = 'RIO00001'")).rows[0]!.id);
      await sql("INSERT INTO entry_answers (submission_id, question_set_id, question_id, question_type, value_text, answered_at) VALUES (?, ?, ?, 'short_text', 'பதில்', ?)", [sub, v1.id, v1q[0]!.id, new Date()]);
      const answersBefore = JSON.stringify((await sql("SELECT * FROM entry_answers ORDER BY id")).rows);
      const v1Before = JSON.stringify((await sql("SELECT * FROM questions WHERE question_set_id = ? ORDER BY id", [v1.id])).rows);

      const id2 = await draft("alpha");
      const d2 = await detail("alpha", id2);
      expect(d2.set.version).toBe(2);
      expect(d2.questions.map((q: Json) => [q.key, q.type, q.promptTa, q.promptEn, q.options])).toEqual(v1q.map((q) => [q.key, q.type, q.promptTa, q.promptEn, q.options]));
      expect(d2.questions.map((q: Json) => q.id)).not.toEqual(v1q.map((q) => q.id)); // new rows: the old ones are never edited
      // edit the revision
      await A(P("alpha", id2, `/questions/${d2.questions[0].id}`), { method: "PATCH", body: short({ promptEn: "New wording", required: true }) });
      const added = await add("alpha", id2, short({ promptEn: "Another" }));
      expect(added.body.key).toBe("q3");
      // version 1 is untouched while the draft exists
      expect(JSON.stringify((await sql("SELECT * FROM questions WHERE question_set_id = ? ORDER BY id", [v1.id])).rows)).toBe(v1Before);
      expect((await detail("alpha", v1.id)).questions[0].promptEn).toBe(TA.en);

      const result = await publish("alpha", id2);
      expect(result).toMatchObject({ version: 2, retiredPrevious: 1 });
      const states = (await A(P("alpha"))).body.sets.map((s: Json) => [s.version, s.status, s.entryCount]);
      expect(states).toEqual([[2, "published", 0], [1, "retired", 1]]);
      expect(await scalar("SELECT COUNT(*) AS n FROM question_sets WHERE event_id = ? AND status = 'published'", [ev.alpha])).toBe(1);
      // historical answers: unchanged, still linked to the version-1 question
      expect(JSON.stringify((await sql("SELECT * FROM entry_answers ORDER BY id")).rows)).toBe(answersBefore);
      expect(JSON.stringify((await sql("SELECT * FROM questions WHERE question_set_id = ? ORDER BY id", [v1.id])).rows)).toBe(v1Before);
      expect(await scalar("SELECT COUNT(*) AS n FROM entry_answers a JOIN questions q ON q.id = a.question_id WHERE q.question_set_id = ? AND a.submission_id = ?", [v1.id, sub])).toBe(1);
      expect(await scalar("SELECT question_set_id AS n FROM submissions WHERE id = ?", [sub])).toBe(v1.id);
      // a retired set cannot be edited or published again
      expect((await A(P("alpha", v1.id, "/publish"), { method: "POST", body: { confirm: true } })).body.error.code).toBe("not_a_draft");
      expect((await add("alpha", v1.id, short())).status).toBe(409);
      // parents now get version 2
      expect((await call("/api/v1/events")).body.events.find((e: Json) => e.slug === "alpha").questionSet.version).toBe(2);
    });

    it("can start a revision blank", async () => {
      const id = await draft("alpha", "blank");
      expect((await detail("alpha", id)).questions).toEqual([]);
      await A(P("alpha", id), { method: "DELETE" });
    });

    it("discarding a draft removes it and its questions and nothing else", async () => {
      const published = await scalar("SELECT COUNT(*) AS n FROM questions");
      const id = await draft("alpha");
      await add("alpha", id, short());
      expect((await A(P("alpha", id), { method: "DELETE" })).status).toBe(204);
      expect((await A(P("alpha", id))).status).toBe(404);
      expect(await scalar("SELECT COUNT(*) AS n FROM questions")).toBe(published);
    });
  });

  describe("concurrency", () => {
    it("two simultaneous publishes of the same draft: exactly one wins, one competition never has two published sets", async () => {
      const id = await draft("alpha");
      await add("alpha", id, short({ promptEn: "Concurrent" }));
      const replies = await Promise.all([1, 2, 3, 4].map(() => A(P("alpha", id, "/publish"), { method: "POST", body: { confirm: true } })));
      const codes = replies.map((r) => r.status).sort();
      expect(codes.filter((c) => c === 200)).toHaveLength(1);
      expect(codes.filter((c) => c === 409)).toHaveLength(3);
      expect(await scalar("SELECT COUNT(*) AS n FROM question_sets WHERE event_id = ? AND status = 'published'", [ev.alpha])).toBe(1);
      expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'question_set.publish' AND entity_id = ?", [String(id)])).toBe(1);
    });
    it("two simultaneous requests for a draft create one draft", async () => {
      const replies = await Promise.all([1, 2, 3].map(() => A(P("beta"), { method: "POST", body: {} })));
      expect(replies.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(await scalar("SELECT COUNT(*) AS n FROM question_sets WHERE event_id = ? AND status = 'draft'", [ev.beta])).toBe(1);
      await discardAll("beta");
    });
    it("the database alone refuses two published sets for one competition", async () => {
      const id = await draft("alpha");
      await expect(sql("UPDATE question_sets SET status = 'published', published_at = ? WHERE id = ?", [new Date(), id])).rejects.toMatchObject({ kind: "constraint" });
      await A(P("alpha", id), { method: "DELETE" });
    });
  });

  describe("cross-competition isolation", () => {
    it("a set or question of one competition cannot be read, changed or published through another", async () => {
      const a = await draft("alpha", "blank");
      const qa = (await add("alpha", a, short({ promptEn: "Alpha only" }))).body;
      const b = await draft("beta");
      const qb = (await add("beta", b, short({ promptEn: "Beta only" }))).body;
      for (const [method, path, body] of [
        ["GET", P("beta", a), undefined], ["GET", P("beta", a, "/preview"), undefined], ["POST", P("beta", a, "/questions"), short()],
        ["PATCH", P("beta", a, `/questions/${qa.id}`), short()], ["DELETE", P("beta", a, `/questions/${qa.id}`), undefined], ["PUT", P("beta", a, "/order"), { order: [qa.id] }],
        ["POST", P("beta", a, "/publish"), { confirm: true }], ["DELETE", P("beta", a), undefined],
        ["PATCH", P("alpha", a, `/questions/${qb.id}`), short()], ["DELETE", P("alpha", a, `/questions/${qb.id}`), undefined],
      ] as const) {
        const r = await A(path, { method, body });
        expect(r.status, `${method} ${path}`).toBe(404);
        expect(r.text).not.toContain("Alpha only");
      }
      expect((await detail("alpha", a)).questions.map((q: Json) => q.promptEn)).toEqual(["Alpha only"]);
      expect((await detail("beta", b)).questions.map((q: Json) => q.promptEn)).toEqual(["Beta only"]);
      await discardAll("alpha");
      await discardAll("beta");
    });
  });

  describe("audit", () => {
    it("records every configuration change with ids and labels only, never the wording", async () => {
      const rows = (await sql<{ action: string; actor_staff_id: number; details: unknown }>("SELECT action, actor_staff_id, details FROM audit_log WHERE action LIKE 'question%' ORDER BY id")).rows;
      const actions = new Set(rows.map((r) => r.action));
      for (const a of ["question_set.create", "question_set.discard", "question_set.publish", "question.add", "question.update", "question.delete", "question.reorder"]) expect(actions.has(a), a).toBe(true);
      expect(rows.every((r) => Number(r.actor_staff_id) === admin.id)).toBe(true);
      const all = JSON.stringify(rows);
      for (const word of [TA.prompt, TA.en, "Concurrent", "Alpha only", "New wording", "Stories"]) expect(all).not.toContain(word);
      expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE actor_staff_id = ? AND action LIKE 'question%'", [judge.id])).toBe(0);
    });
    it("does not log a refused request as a change", async () => {
      const before = await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'question%'");
      const id = await draft("beta");
      await add("beta", id, short({ promptEn: "<b>x</b>" }));
      await A(P("beta", id, "/order"), { method: "PUT", body: { order: [1] } });
      expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'question%'")).toBe(before + 1); // only the draft creation
      await discardAll("beta");
    });
  });

  it("never returns participant details from any question route", async () => {
    const a = (await A(P("alpha"))).body;
    const text = JSON.stringify(a) + (await A("/api/v1/admin/competitions")).text;
    expect(text).not.toMatch(/guardian|mobile|child_name|9876543210/i);
    expect(randomUUID()).toBeTruthy();
  });
});
