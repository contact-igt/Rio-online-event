import { z } from "zod";
import { writeAudit } from "../auth/audit.ts";
import type { Queryable } from "../db/adapter.ts";
import { asDate } from "../db/values.ts";
import { AppError } from "../http/errors.ts";

// What the administrator's Registrations screens show, straight from the database. The list holds the child's and guardian's names so an entry
// can be found; contact details (mobile, e-mail) appear only on one entry's detail, and opening a detail is written to the audit log (ids only).
// Answers are shown against the questions of the set the entry was created with, not the set that is published now.

export const STATUSES = ["draft", "held", "finalized", "withdrawn", "rejected"] as const;
export const PAGE_SIZE = 25;

export const listQuery = z.strictObject({
  competition: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/u).max(60).optional(),
  status: z.enum(STATUSES).optional(),
  page: z.string().regex(/^[1-9][0-9]{0,5}$/u).transform(Number).optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

export type RegistrationRow = {
  entryCode: string;
  status: string;
  competitionSlug: string;
  competitionNameTa: string;
  competitionNameEn: string;
  questionSetVersion: number;
  childName: string;
  childAge: number;
  guardianName: string;
  answered: number;
  openDuplicateFlag: boolean;
  createdAt: string;
  updatedAt: string;
};
export type RegistrationList = { registrations: RegistrationRow[]; total: number; page: number; pageSize: number };

const n = (v: unknown): number => Number(v ?? 0);

export async function listRegistrations(db: Queryable, query: ListQuery): Promise<RegistrationList> {
  const where: string[] = [];
  const params: string[] = [];
  if (query.competition) {
    where.push("e.slug = ?");
    params.push(query.competition);
  }
  if (query.status) {
    where.push("s.status = ?");
    params.push(query.status);
  }
  const filter = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const page = query.page ?? 1;
  const total = n((await db.query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM submissions s JOIN events e ON e.id = s.event_id ${filter}`, params)).rows[0]?.n);
  // page and PAGE_SIZE are validated integers, so they are written into the statement (a bound LIMIT is not accepted by every MySQL-protocol server).
  const rows = (
    await db.query<{
      entry_code: string; status: string; slug: string; name_ta: string; name_en: string; version: unknown; child_name: string; child_age: unknown; guardian_name: string;
      answered: unknown; dup: unknown; created_at: unknown; updated_at: unknown;
    }>(
      `SELECT s.entry_code, s.status, e.slug, e.name_ta, e.name_en, qs.version, s.child_name, s.child_age, s.guardian_name, s.created_at, s.updated_at,
         (SELECT COUNT(*) FROM entry_answers a WHERE a.submission_id = s.id) AS answered,
         (SELECT COUNT(*) FROM duplicate_reviews d WHERE d.submission_id = s.id AND d.status IN ('held', 'flagged')) AS dup
       FROM submissions s JOIN events e ON e.id = s.event_id JOIN question_sets qs ON qs.id = s.question_set_id ${filter}
       ORDER BY s.created_at DESC, s.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      params,
    )
  ).rows;
  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    registrations: rows.map((r) => ({
      entryCode: r.entry_code,
      status: r.status,
      competitionSlug: r.slug,
      competitionNameTa: r.name_ta,
      competitionNameEn: r.name_en,
      questionSetVersion: n(r.version),
      childName: r.child_name,
      childAge: n(r.child_age),
      guardianName: r.guardian_name,
      answered: n(r.answered),
      openDuplicateFlag: n(r.dup) > 0,
      createdAt: asDate(r.created_at).toISOString(),
      updatedAt: asDate(r.updated_at).toISOString(),
    })),
  };
}

type Option = { code: string; ta: string; en: string };
export type DetailAnswer = {
  key: string;
  type: string;
  promptTa: string;
  promptEn: string;
  required: boolean;
  value: string | number | string[] | null;
  /** For the choice types: the labels of the chosen options. */
  chosen: { ta: string; en: string }[] | null;
};
export type RegistrationDetail = {
  entryCode: string;
  status: string;
  competition: { slug: string; nameTa: string; nameEn: string };
  questionSetVersion: number;
  child: { name: string; age: number };
  guardian: { name: string; mobile: string; email: string | null };
  consent: { guardian: { version: string | null; at: string | null }; media: { granted: boolean | null; version: string | null; at: string | null } };
  answers: DetailAnswer[];
  duplicates: { status: string; reason: string; matchedEntryCode: string | null }[];
  createdAt: string;
  updatedAt: string;
};

const json = (value: unknown): unknown => (typeof value === "string" ? JSON.parse(value) : value);
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : asDate(v).toISOString());

/** The entry with this code, or a 404. The audit row is written before anything is returned, so a failed audit write fails the read. */
export async function loadRegistration(db: Queryable, now: Date, actor: { staffId: number; requestId: string }, entryCode: string): Promise<RegistrationDetail> {
  const s = (
    await db.query<{
      id: unknown; entry_code: string; status: string; child_name: string; child_age: unknown; guardian_name: string; guardian_mobile: string; guardian_email: string | null;
      gcv: string | null; gca: unknown; mc: unknown; mcv: string | null; mca: unknown; created_at: unknown; updated_at: unknown; question_set_id: unknown;
      slug: string; name_ta: string; name_en: string; version: unknown;
    }>(
      `SELECT s.id, s.entry_code, s.status, s.child_name, s.child_age, s.guardian_name, s.guardian_mobile, s.guardian_email,
         s.guardian_consent_version AS gcv, s.guardian_consent_at AS gca, s.media_consent AS mc, s.media_consent_version AS mcv, s.media_consent_at AS mca,
         s.created_at, s.updated_at, s.question_set_id, e.slug, e.name_ta, e.name_en, qs.version
       FROM submissions s JOIN events e ON e.id = s.event_id JOIN question_sets qs ON qs.id = s.question_set_id WHERE s.entry_code = ?`,
      [entryCode],
    )
  ).rows[0];
  if (!s) throw new AppError(404, "not_found", "Not found.");
  const id = n(s.id);

  const answerRows = (
    await db.query<{ k: string; type: string; position: unknown; prompt_ta: string; prompt_en: string; required: unknown; options_json: unknown; value_text: string | null; value_number: unknown; value_json: unknown; has: unknown }>(
      `SELECT q.question_key AS k, q.type, q.position, q.prompt_ta, q.prompt_en, q.required, q.options_json, a.value_text, a.value_number, a.value_json, a.id AS has
       FROM questions q LEFT JOIN entry_answers a ON a.question_id = q.id AND a.submission_id = ? WHERE q.question_set_id = ? ORDER BY q.position`,
      [id, n(s.question_set_id)],
    )
  ).rows;
  const answers: DetailAnswer[] = answerRows
    .filter((r) => r.type !== "instruction")
    .map((r) => {
      const options = r.options_json === null || r.options_json === undefined ? [] : (json(r.options_json) as Option[]);
      let value: DetailAnswer["value"] = null;
      if (r.has !== null && r.has !== undefined) {
        value = r.type === "number" ? n(r.value_number) : r.type === "checkboxes" ? (json(r.value_json) as string[]) : (r.value_text ?? "");
      }
      const codes = value === null ? [] : Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
      const choice = r.type === "dropdown" || r.type === "radio" || r.type === "checkboxes";
      return {
        key: r.k,
        type: r.type,
        promptTa: r.prompt_ta,
        promptEn: r.prompt_en,
        required: n(r.required) === 1,
        value,
        chosen: choice ? codes.map((c) => options.find((o) => o.code === c)).filter((o): o is Option => o !== undefined).map((o) => ({ ta: o.ta, en: o.en })) : null,
      };
    });

  const duplicates = (
    await db.query<{ status: string; reason: string; matched: string | null }>(
      `SELECT d.status, d.reason, m.entry_code AS matched FROM duplicate_reviews d LEFT JOIN submissions m ON m.id = d.matched_submission_id WHERE d.submission_id = ? ORDER BY d.id`,
      [id],
    )
  ).rows;

  await writeAudit(db, now, { actorType: "staff", actorStaffId: actor.staffId, action: "registration.viewed", entityType: "submission", entityId: id, requestId: actor.requestId });

  return {
    entryCode: s.entry_code,
    status: s.status,
    competition: { slug: s.slug, nameTa: s.name_ta, nameEn: s.name_en },
    questionSetVersion: n(s.version),
    child: { name: s.child_name, age: n(s.child_age) },
    guardian: { name: s.guardian_name, mobile: s.guardian_mobile, email: s.guardian_email },
    consent: {
      guardian: { version: s.gcv, at: isoOrNull(s.gca) },
      media: { granted: s.mc === null || s.mc === undefined ? null : n(s.mc) === 1, version: s.mcv, at: isoOrNull(s.mca) },
    },
    answers,
    duplicates: duplicates.map((d) => ({ status: d.status, reason: d.reason, matchedEntryCode: d.matched })),
    createdAt: asDate(s.created_at).toISOString(),
    updatedAt: asDate(s.updated_at).toISOString(),
  };
}
