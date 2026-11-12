import { z } from "zod";
import { writeAudit } from "../auth/audit.ts";
import type { DatabaseAdapter, Queryable, SqlValue, Transaction } from "../db/adapter.ts";
import { DatabaseError } from "../db/errors.ts";
import { asDate } from "../db/values.ts";
import { AppError } from "../http/errors.ts";

// The question builder (M5B). A competition has versioned question sets: any number of `retired` ones, at most one `published` one and at most
// one `draft`. Only a draft can be changed. Publishing retires the current published set and publishes the draft in one transaction; the database
// (triggers and a unique key, migrations 0004 and 0012) refuses every other path, so these rules hold even for a bug in this file.
//   * Editing wording after publication means a new draft that starts as a copy of the published set (same question keys and option codes, so
//     the meaning of earlier answers carries over). Entries already started keep the set they were created with; nothing of theirs is touched.
//   * "Inactive" is a draft-only parking state: inactive questions are removed when the draft is published, because a published set is immutable.
//   * Nothing publishes by itself: publishing needs an explicit request with confirm = true.

export type QuestionType = "short_text" | "paragraph" | "dropdown" | "radio" | "checkboxes" | "number" | "instruction";
export type Option = { code: string; ta: string; en: string };
export type AdminQuestion = {
  id: number;
  key: string;
  type: QuestionType;
  position: number;
  active: boolean;
  promptTa: string;
  promptEn: string;
  helpTa: string | null;
  helpEn: string | null;
  required: boolean;
  options: Option[] | null;
  maxLength: number | null;
  minNumber: number | null;
  maxNumber: number | null;
  minChoices: number | null;
  maxChoices: number | null;
};

export const MAX_QUESTIONS = 60;
const MAX_OPTIONS = 30;

export class FieldsInvalid extends AppError {
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string>, status = 422, code = "invalid_question") {
    super(status, code, "The question is not valid.");
    this.fields = fields;
  }
}
const notFound = () => new AppError(404, "not_found", "Not found.");
const conflict = (code: string, message: string) => new AppError(409, code, message);

// ---- input ------------------------------------------------------------------------------------------------------------------------------

/** One line of text: Unicode NFC, whitespace collapsed, no control characters and no angle brackets (nothing that could be read as markup). */
const text = (max: number) =>
  z.string().transform((s) => s.normalize("NFC").replace(/\s+/gu, " ").trim()).pipe(
    z.string().max(max, "too_long").refine((s) => !/[<>]/u.test(s), "unsafe_text").refine((s) => !/\p{Cc}/u.test(s), "invalid_text"),
  );
const required = (max: number) => text(max).pipe(z.string().min(1, "required"));
const optional = (max: number) => text(max).nullable().optional().transform((v) => (v === undefined || v === "" ? null : v));

const optionSchema = z.strictObject({ code: z.string().regex(/^[a-z0-9_]{1,40}$/, "invalid_code").optional(), ta: required(200), en: required(200) });
const options = z.array(optionSchema).min(2, "min_two_options").max(MAX_OPTIONS, "too_many_options");
const count = z.number().int().min(0).max(255);
const finite = z.number().finite().min(-1e9).max(1e9);

const base = { promptTa: required(500), promptEn: required(500), helpTa: optional(1000), helpEn: optional(1000), active: z.boolean().default(true) };
export const questionBody = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("short_text"), ...base, required: z.boolean().default(false), maxLength: z.number().int().min(1).max(500).nullable().default(null) }),
  z.strictObject({ type: z.literal("paragraph"), ...base, required: z.boolean().default(false), maxLength: z.number().int().min(1).max(4000).nullable().default(null) }),
  z.strictObject({ type: z.literal("dropdown"), ...base, required: z.boolean().default(false), options }),
  z.strictObject({ type: z.literal("radio"), ...base, required: z.boolean().default(false), options }),
  z.strictObject({ type: z.literal("checkboxes"), ...base, required: z.boolean().default(false), options, minChoices: count.nullable().default(null), maxChoices: count.min(1).nullable().default(null) }),
  z.strictObject({ type: z.literal("number"), ...base, required: z.boolean().default(false), minNumber: finite.nullable().default(null), maxNumber: finite.nullable().default(null) }),
  z.strictObject({ type: z.literal("instruction"), ...base, required: z.literal(false).default(false) }),
]);
export type QuestionInput = z.infer<typeof questionBody>;

export const createSetBody = z.strictObject({ startFrom: z.enum(["published", "blank"]).default("published") });
export const reorderBody = z.strictObject({ order: z.array(z.number().int().positive()).min(1).max(MAX_QUESTIONS) });
export const publishBody = z.strictObject({ confirm: z.literal(true) });

/** Cross-field rules the single-field schemas cannot express. Returns field codes; empty means valid. */
export function questionProblems(q: QuestionInput): Record<string, string> {
  const out: Record<string, string> = {};
  if (q.type === "number" && q.minNumber !== null && q.maxNumber !== null && q.minNumber > q.maxNumber) out.maxNumber = "max_below_min";
  if (q.type === "checkboxes") {
    const n = q.options.length;
    if (q.minChoices !== null && q.minChoices > n) out.minChoices = "min_above_options";
    if (q.maxChoices !== null && q.maxChoices > n) out.maxChoices = "max_above_options";
    if (q.minChoices !== null && q.maxChoices !== null && q.minChoices > q.maxChoices) out.maxChoices = "max_below_min";
    if (q.required && q.minChoices === 0) out.minChoices = "required_needs_one";
  }
  if ("options" in q) {
    const codes = q.options.map((o) => o.code).filter((c): c is string => c !== undefined);
    if (new Set(codes).size !== codes.length) out.options = "duplicate_code";
    const labels = q.options.map((o) => `${o.ta}\u0000${o.en}`);
    if (new Set(labels).size !== labels.length) out.options = "duplicate_option";
  }
  return out;
}

// ---- reading ----------------------------------------------------------------------------------------------------------------------------

type Row = {
  id: number | string; question_key: string; type: QuestionType; position: number | string; active: number; prompt_ta: string; prompt_en: string; help_ta: string | null; help_en: string | null;
  required: number; options_json: unknown; max_length: number | null; min_number: number | null; max_number: number | null; min_choices: number | null; max_choices: number | null;
};
const COLUMNS = "id, question_key, type, position, active, prompt_ta, prompt_en, help_ta, help_en, required, options_json, max_length, min_number, max_number, min_choices, max_choices";
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const parseOptions = (v: unknown): Option[] | null => (v === null || v === undefined ? null : ((typeof v === "string" ? JSON.parse(v) : v) as Option[]));

const toQuestion = (r: Row): AdminQuestion => ({
  id: Number(r.id), key: r.question_key, type: r.type, position: Number(r.position), active: Number(r.active) === 1, promptTa: r.prompt_ta, promptEn: r.prompt_en, helpTa: r.help_ta, helpEn: r.help_en,
  required: Number(r.required) === 1, options: parseOptions(r.options_json), maxLength: num(r.max_length), minNumber: num(r.min_number), maxNumber: num(r.max_number), minChoices: num(r.min_choices), maxChoices: num(r.max_choices),
});

type SetRow = { id: number | string; event_id: number | string; version: number | string; status: "draft" | "published" | "retired"; created_at: unknown; published_at: unknown; retired_at: unknown };
export type SetSummary = { id: number; version: number; status: "draft" | "published" | "retired"; createdAt: string; publishedAt: string | null; retiredAt: string | null; questionCount: number; entryCount: number };

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : asDate(v).toISOString());
const SET_COLUMNS = "id, event_id, version, status, created_at, published_at, retired_at";

async function eventBySlug(q: Queryable, slug: string): Promise<{ id: number; slug: string; nameTa: string; nameEn: string } | null> {
  const r = (await q.query<{ id: number | string; slug: string; name_ta: string; name_en: string }>("SELECT id, slug, name_ta, name_en FROM events WHERE slug = ?", [slug])).rows[0];
  return r ? { id: Number(r.id), slug: r.slug, nameTa: r.name_ta, nameEn: r.name_en } : null;
}

/** The set, only if it belongs to this competition: a set id from another competition is "not found", never readable or writable here. */
async function setOf(q: Queryable, eventId: number, setId: number, lock = false): Promise<SetRow> {
  const sql = `SELECT ${SET_COLUMNS} FROM question_sets WHERE id = ? AND event_id = ?${lock ? " FOR UPDATE" : ""}`;
  const row = (await q.query<SetRow>(sql, [setId, eventId])).rows[0];
  if (!row) throw notFound();
  return row;
}
const draftOf = async (tx: Transaction, eventId: number, setId: number): Promise<SetRow> => {
  const set = await setOf(tx, eventId, setId, tx.dialect === "mysql");
  if (set.status !== "draft") throw conflict("not_a_draft", "Only a draft can be changed. Create a new draft revision instead.");
  return set;
};

async function questionsOf(q: Queryable, setId: number): Promise<AdminQuestion[]> {
  return (await q.query<Row>(`SELECT ${COLUMNS} FROM questions WHERE question_set_id = ? ORDER BY position`, [setId])).rows.map(toQuestion);
}

const toSummaries = (sets: SetRow[], counts: Map<number, number>, entries: Map<number, number>): SetSummary[] =>
  sets.map((s) => ({
    id: Number(s.id), version: Number(s.version), status: s.status, createdAt: iso(s.created_at)!, publishedAt: iso(s.published_at), retiredAt: iso(s.retired_at),
    questionCount: counts.get(Number(s.id)) ?? 0, entryCount: entries.get(Number(s.id)) ?? 0,
  }));
const countMap = (rows: { id: number | string; n: number | string }[]) => new Map(rows.map((r) => [Number(r.id), Number(r.n)]));

// The three reads do not depend on each other, so they are issued together (one database round trip of waiting instead of three).
async function summaries(q: Queryable, eventId: number): Promise<SetSummary[]> {
  const [sets, counts, entries] = await Promise.all([
    q.query<SetRow>(`SELECT ${SET_COLUMNS} FROM question_sets WHERE event_id = ? ORDER BY version DESC`, [eventId]),
    q.query<{ id: number | string; n: number | string }>("SELECT question_set_id AS id, COUNT(*) AS n FROM questions WHERE question_set_id IN (SELECT id FROM question_sets WHERE event_id = ?) GROUP BY question_set_id", [eventId]),
    // Only counts: no entry, child or guardian detail is read.
    q.query<{ id: number | string; n: number | string }>("SELECT question_set_id AS id, COUNT(*) AS n FROM submissions WHERE event_id = ? GROUP BY question_set_id", [eventId]),
  ]);
  return toSummaries(sets.rows, countMap(counts.rows), countMap(entries.rows));
}

export type CompetitionRow = { slug: string; nameTa: string; nameEn: string; published: SetSummary | null; draft: SetSummary | null };

// All competitions in four queries issued together. It used to run three queries per competition one after another (13 round trips).
export async function listCompetitions(db: Queryable): Promise<CompetitionRow[]> {
  const [events, sets, counts, entries] = await Promise.all([
    db.query<{ id: number | string; slug: string; name_ta: string; name_en: string }>("SELECT id, slug, name_ta, name_en FROM events ORDER BY display_order, id"),
    db.query<SetRow>(`SELECT ${SET_COLUMNS} FROM question_sets ORDER BY version DESC`),
    db.query<{ id: number | string; n: number | string }>("SELECT question_set_id AS id, COUNT(*) AS n FROM questions GROUP BY question_set_id"),
    db.query<{ id: number | string; n: number | string }>("SELECT question_set_id AS id, COUNT(*) AS n FROM submissions GROUP BY question_set_id"),
  ]);
  const countsBySet = countMap(counts.rows);
  const entriesBySet = countMap(entries.rows);
  return events.rows.map((e) => {
    const own = toSummaries(sets.rows.filter((row) => Number(row.event_id) === Number(e.id)), countsBySet, entriesBySet);
    return { slug: e.slug, nameTa: e.name_ta, nameEn: e.name_en, published: own.find((x) => x.status === "published") ?? null, draft: own.find((x) => x.status === "draft") ?? null };
  });
}

export async function listSets(db: Queryable, slug: string) {
  const event = await eventBySlug(db, slug);
  if (!event) throw notFound();
  return { competition: event, sets: await summaries(db, event.id) };
}

export async function getSet(db: Queryable, slug: string, setId: number) {
  const event = await eventBySlug(db, slug);
  if (!event) throw notFound();
  const set = await setOf(db, event.id, setId);
  const summary = (await summaries(db, event.id)).find((s) => s.id === Number(set.id))!;
  return { competition: event, set: summary, questions: await questionsOf(db, setId) };
}

// ---- preview and publishing checks ------------------------------------------------------------------------------------------------------

/** What would stop a draft from being published. Empty means it can be. */
export function publishProblems(questions: readonly AdminQuestion[]): { key: string; code: string }[] {
  const active = questions.filter((q) => q.active);
  const out: { key: string; code: string }[] = [];
  if (active.length === 0) out.push({ key: "", code: "no_active_questions" });
  if (!active.some((q) => q.type !== "instruction")) if (active.length > 0) out.push({ key: "", code: "only_instructions" });
  for (const q of active) if (q.options !== null && q.options.length < 2) out.push({ key: q.key, code: "min_two_options" });
  return out;
}

/** The set as a parent would see it: active questions only, in order, in the shape the public registration endpoints use. */
export async function previewSet(db: Queryable, slug: string, setId: number) {
  const data = await getSet(db, slug, setId);
  const active = data.questions.filter((q) => q.active || data.set.status !== "draft");
  return {
    competition: data.competition,
    set: data.set,
    questions: active.map((q) => ({
      key: q.key, type: q.type, position: q.position, promptTa: q.promptTa, promptEn: q.promptEn, helpTa: q.helpTa, helpEn: q.helpEn, required: q.required, options: q.options,
      maxLength: q.maxLength, minNumber: q.minNumber, maxNumber: q.maxNumber, minChoices: q.minChoices, maxChoices: q.maxChoices,
    })),
    inactiveCount: data.questions.length - active.length,
    problems: data.set.status === "draft" ? publishProblems(data.questions) : [],
  };
}

// ---- changes ----------------------------------------------------------------------------------------------------------------------------

type Actor = { staffId: number; requestId: string };
const audit = (tx: Queryable, now: Date, actor: Actor, action: string, entityType: string, entityId: number, details: Record<string, string | number | boolean | null>) =>
  writeAudit(tx, now, { actorType: "staff", actorStaffId: actor.staffId, action, entityType, entityId, requestId: actor.requestId, details });

export async function createDraft(db: DatabaseAdapter, now: Date, actor: Actor, slug: string, startFrom: "published" | "blank") {
  return db.transaction(async (tx) => {
    const event = await eventBySlug(tx, slug);
    if (!event) throw notFound();
    const sets = await summaries(tx, event.id);
    const existing = sets.find((s) => s.status === "draft");
    if (existing) throw new FieldsInvalid({ draft: String(existing.id) }, 409, "draft_exists");
    const published = sets.find((s) => s.status === "published");
    const version = Math.max(0, ...sets.map((s) => s.version)) + 1;
    // The unique key on (event, version) makes two simultaneous creates collide: the loser gets a 409, not a second draft.
    await tx.query("INSERT INTO question_sets (event_id, version, status, created_by, created_at) VALUES (?, ?, 'draft', ?, ?)", [event.id, version, actor.staffId, now]);
    const id = Number((await tx.query<{ id: number | string }>("SELECT id FROM question_sets WHERE event_id = ? AND version = ?", [event.id, version])).rows[0]!.id);
    let copied = 0;
    if (published && startFrom === "published") {
      copied = (await tx.query(
        `INSERT INTO questions (question_set_id, position, question_key, type, prompt_ta, prompt_en, help_ta, help_en, required, options_json, max_length, min_number, max_number, active, min_choices, max_choices)
         SELECT ?, position, question_key, type, prompt_ta, prompt_en, help_ta, help_en, required, options_json, max_length, min_number, max_number, 1, min_choices, max_choices
           FROM questions WHERE question_set_id = ?`,
        [id, published.id],
      )).affectedRows;
    }
    await audit(tx, now, actor, "question_set.create", "question_set", id, { competition: slug, version, copiedQuestions: copied, basedOn: published && startFrom === "published" ? published.version : null });
    return { id, version, copiedQuestions: copied };
  });
}

export async function discardDraft(db: DatabaseAdapter, now: Date, actor: Actor, slug: string, setId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const event = await eventBySlug(tx, slug);
    if (!event) throw notFound();
    const set = await draftOf(tx, event.id, setId);
    await tx.query("DELETE FROM questions WHERE question_set_id = ?", [setId]);
    await tx.query("DELETE FROM question_sets WHERE id = ? AND status = 'draft'", [setId]);
    await audit(tx, now, actor, "question_set.discard", "question_set", setId, { competition: slug, version: Number(set.version) });
  });
}

const nextKey = (existing: readonly string[]): string => {
  const used = existing.map((k) => /^q(\d+)$/u.exec(k)?.[1]).filter((n): n is string => n !== undefined).map(Number);
  return `q${Math.max(0, ...used) + 1}`;
};

/** Gives every option without a code the next free one, keeping the codes it already has (answers refer to codes, never to labels). */
function withCodes(list: readonly { code?: string | undefined; ta: string; en: string }[], taken: readonly string[] = []): Option[] {
  const used = new Set([...taken, ...list.map((o) => o.code).filter((c): c is string => c !== undefined)]);
  let n = 0;
  return list.map((o) => {
    if (o.code !== undefined) return { code: o.code, ta: o.ta, en: o.en };
    do n += 1; while (used.has(`o${n}`));
    used.add(`o${n}`);
    return { code: `o${n}`, ta: o.ta, en: o.en };
  });
}

function values(q: QuestionInput): SqlValue[] {
  const o = "options" in q ? JSON.stringify(withCodes(q.options)) : null;
  return [
    q.promptTa, q.promptEn, q.helpTa, q.helpEn, q.required ? 1 : 0, o,
    "maxLength" in q ? q.maxLength : null, "minNumber" in q ? q.minNumber : null, "maxNumber" in q ? q.maxNumber : null,
    q.active ? 1 : 0, "minChoices" in q ? q.minChoices : null, "maxChoices" in q ? q.maxChoices : null,
  ];
}

function checked(q: QuestionInput): void {
  const problems = questionProblems(q);
  if (Object.keys(problems).length > 0) throw new FieldsInvalid(problems);
}

export async function addQuestion(db: DatabaseAdapter, now: Date, actor: Actor, slug: string, setId: number, input: QuestionInput): Promise<AdminQuestion> {
  checked(input);
  return db.transaction(async (tx) => {
    const event = await eventBySlug(tx, slug);
    if (!event) throw notFound();
    await draftOf(tx, event.id, setId);
    const existing = (await tx.query<{ question_key: string; position: number | string }>("SELECT question_key, position FROM questions WHERE question_set_id = ?", [setId])).rows;
    if (existing.length >= MAX_QUESTIONS) throw new FieldsInvalid({ question: "too_many_questions" }, 409, "too_many_questions");
    const key = nextKey(existing.map((r) => r.question_key));
    const position = Math.max(0, ...existing.map((r) => Number(r.position))) + 1;
    const v = values(input);
    await tx.query(
      `INSERT INTO questions (question_set_id, position, question_key, type, prompt_ta, prompt_en, help_ta, help_en, required, options_json, max_length, min_number, max_number, active, min_choices, max_choices)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [setId, position, key, input.type, ...v],
    );
    const row = (await tx.query<Row>(`SELECT ${COLUMNS} FROM questions WHERE question_set_id = ? AND question_key = ?`, [setId, key])).rows[0]!;
    await audit(tx, now, actor, "question.add", "question", Number(row.id), { competition: slug, setId, key, type: input.type, position });
    return toQuestion(row);
  });
}

export async function updateQuestion(db: DatabaseAdapter, now: Date, actor: Actor, slug: string, setId: number, questionId: number, input: QuestionInput): Promise<AdminQuestion> {
  checked(input);
  return db.transaction(async (tx) => {
    const event = await eventBySlug(tx, slug);
    if (!event) throw notFound();
    await draftOf(tx, event.id, setId);
    const current = (await tx.query<Row>(`SELECT ${COLUMNS} FROM questions WHERE id = ? AND question_set_id = ?`, [questionId, setId])).rows[0];
    if (!current) throw notFound();
    if (current.type !== input.type) throw new FieldsInvalid({ type: "type_cannot_change" });
    const result = await tx.query(
      `UPDATE questions SET prompt_ta = ?, prompt_en = ?, help_ta = ?, help_en = ?, required = ?, options_json = ?, max_length = ?, min_number = ?, max_number = ?, active = ?, min_choices = ?, max_choices = ?
        WHERE id = ? AND question_set_id = ?`,
      [...values(input), questionId, setId],
    );
    if (result.affectedRows !== 1) throw notFound();
    await audit(tx, now, actor, "question.update", "question", questionId, { competition: slug, setId, key: current.question_key, type: input.type });
    return toQuestion((await tx.query<Row>(`SELECT ${COLUMNS} FROM questions WHERE id = ?`, [questionId])).rows[0]!);
  });
}

export async function deleteQuestion(db: DatabaseAdapter, now: Date, actor: Actor, slug: string, setId: number, questionId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const event = await eventBySlug(tx, slug);
    if (!event) throw notFound();
    await draftOf(tx, event.id, setId);
    const current = (await tx.query<{ question_key: string }>("SELECT question_key FROM questions WHERE id = ? AND question_set_id = ?", [questionId, setId])).rows[0];
    if (!current) throw notFound();
    // A draft's questions have no answers (entries are only created against a published set), and the database refuses to delete one that does.
    await tx.query("DELETE FROM questions WHERE id = ? AND question_set_id = ?", [questionId, setId]);
    await audit(tx, now, actor, "question.delete", "question", questionId, { competition: slug, setId, key: current.question_key });
  });
}

export async function reorderQuestions(db: DatabaseAdapter, now: Date, actor: Actor, slug: string, setId: number, order: readonly number[]): Promise<AdminQuestion[]> {
  return db.transaction(async (tx) => {
    const event = await eventBySlug(tx, slug);
    if (!event) throw notFound();
    await draftOf(tx, event.id, setId);
    const ids = (await tx.query<{ id: number | string }>("SELECT id FROM questions WHERE question_set_id = ?", [setId])).rows.map((r) => Number(r.id));
    if (order.length !== ids.length || new Set(order).size !== order.length || !order.every((id) => ids.includes(id))) {
      throw new FieldsInvalid({ order: "must_list_every_question_once" }, 422, "invalid_order");
    }
    // (set, position) is unique, so the questions first move out of the way and then take their new places.
    await tx.query("UPDATE questions SET position = position + 1000 WHERE question_set_id = ?", [setId]);
    for (const [index, id] of order.entries()) await tx.query("UPDATE questions SET position = ? WHERE id = ? AND question_set_id = ?", [index + 1, id, setId]);
    await audit(tx, now, actor, "question.reorder", "question_set", setId, { competition: slug, count: order.length });
    return questionsOf(tx, setId);
  });
}

/** Publishes one competition's draft inside the caller's transaction. `details` adds labels to the audit row. */
async function publishDraft(tx: Transaction, now: Date, actor: Actor, event: { id: number; slug: string }, setId: number, details: Record<string, string | number | null> = {}) {
  // Row lock on MySQL; SQLite locks the whole database for a write transaction. Either way a second publish of the same draft waits and then
  // finds it already published.
  const set = await draftOf(tx, event.id, setId);
  const all = await questionsOf(tx, setId);
  const problems = publishProblems(all);
  if (problems.length > 0) throw new FieldsInvalid(Object.fromEntries(problems.map((p) => [p.key || "set", p.code])), 422, "not_publishable");
  const inactive = all.filter((q) => !q.active).length;
  if (inactive > 0) await tx.query("DELETE FROM questions WHERE question_set_id = ? AND active = 0", [setId]);
  // Order matters: the unique key allows one published set per competition, so the old one is retired first.
  const retired = (await tx.query("UPDATE question_sets SET status = 'retired', retired_at = ? WHERE event_id = ? AND status = 'published'", [now, event.id])).affectedRows;
  const flipped = (await tx.query("UPDATE question_sets SET status = 'published', published_at = ?, published_by = ? WHERE id = ? AND status = 'draft'", [now, actor.staffId, setId])).affectedRows;
  if (flipped !== 1) throw conflict("not_a_draft", "This draft was already published.");
  await audit(tx, now, actor, "question_set.publish", "question_set", setId, { competition: event.slug, version: Number(set.version), questions: all.length - inactive, removedInactive: inactive, retiredPrevious: retired, ...details });
  return { id: setId, version: Number(set.version), questions: all.length - inactive, removedInactive: inactive, retiredPrevious: retired };
}

export async function publishSet(db: DatabaseAdapter, now: Date, actor: Actor, slug: string, setId: number) {
  return db.transaction(async (tx) => {
    const event = await eventBySlug(tx, slug);
    if (!event) throw notFound();
    return publishDraft(tx, now, actor, event, setId);
  });
}

/**
 * One question list for every competition. The owner asked for the same registration questions in all competitions, so the admin edits ONE
 * draft (in the competition named by `slug`) and this publishes it there and, in the same transaction, as a new version of every other active
 * competition: same question keys, positions and option codes. Each competition still keeps its own versioned sets, so every entry stays bound
 * to the exact wording its parent saw, and all the database rules (immutable published sets, one published set per competition) still apply.
 * A draft another competition still had is discarded first: with one shared editor it can no longer be reached. Either everything is
 * published or nothing is.
 */
export async function publishSetToAll(db: DatabaseAdapter, now: Date, actor: Actor, slug: string, setId: number) {
  return db.transaction(async (tx) => {
    const source = await eventBySlug(tx, slug);
    if (!source) throw notFound();
    const own = await publishDraft(tx, now, actor, source, setId, { shared: 1 });
    const others = (await tx.query<{ id: number | string; slug: string }>("SELECT id, slug FROM events WHERE active = 1 AND id <> ? ORDER BY display_order, id", [source.id])).rows.map((r) => ({ id: Number(r.id), slug: r.slug }));
    const competitions = [{ slug: source.slug, version: own.version }];
    let discardedDrafts = 0;
    for (const event of others) {
      const sets = await summaries(tx, event.id);
      const stale = sets.find((s) => s.status === "draft");
      if (stale) {
        await tx.query("DELETE FROM questions WHERE question_set_id = ?", [stale.id]);
        await tx.query("DELETE FROM question_sets WHERE id = ? AND status = 'draft'", [stale.id]);
        await audit(tx, now, actor, "question_set.discard", "question_set", stale.id, { competition: event.slug, version: stale.version, replacedByShared: 1 });
        discardedDrafts += 1;
      }
      const version = Math.max(0, ...sets.map((s) => s.version)) + 1;
      await tx.query("INSERT INTO question_sets (event_id, version, status, created_by, created_at) VALUES (?, ?, 'draft', ?, ?)", [event.id, version, actor.staffId, now]);
      const id = Number((await tx.query<{ id: number | string }>("SELECT id FROM question_sets WHERE event_id = ? AND version = ?", [event.id, version])).rows[0]!.id);
      await tx.query(
        `INSERT INTO questions (question_set_id, position, question_key, type, prompt_ta, prompt_en, help_ta, help_en, required, options_json, max_length, min_number, max_number, active, min_choices, max_choices)
         SELECT ?, position, question_key, type, prompt_ta, prompt_en, help_ta, help_en, required, options_json, max_length, min_number, max_number, 1, min_choices, max_choices
           FROM questions WHERE question_set_id = ?`,
        [id, setId],
      );
      await audit(tx, now, actor, "question_set.create", "question_set", id, { competition: event.slug, version, copiedQuestions: own.questions, sharedFrom: source.slug });
      const done = await publishDraft(tx, now, actor, event, id, { shared: 1, sharedFrom: source.slug });
      competitions.push({ slug: event.slug, version: done.version });
    }
    return { questions: own.questions, removedInactive: own.removedInactive, discardedDrafts, competitions };
  });
}

/** A database refusal that reaches a route is a rule the request broke (a trigger or constraint), not a server fault. */
export const asRuleViolation = (error: unknown): AppError | null =>
  error instanceof DatabaseError && error.kind === "constraint" ? conflict("rule_violation", "The change is not allowed by the question rules.") : null;
