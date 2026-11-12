import { z } from "zod";
import { writeAudit } from "../auth/audit.ts";
import type { DatabaseAdapter, Queryable, SqlValue } from "../db/adapter.ts";
import { asDate } from "../db/values.ts";
import { AppError } from "../http/errors.ts";
import { cleanEmail, nameKey, parseMobile, parseName } from "../registration/normalize.ts";
import { pendingKey, videoKey, type VideoStore } from "../storage/r2.ts";

// What the administrator's Registrations screens show, straight from the database. The list holds the child's and guardian's names so an entry
// can be found; contact details (mobile, e-mail) appear only on one entry's detail, and opening a detail is written to the audit log (ids only).
// Answers are shown against the questions of the set the entry was created with, not the set that is published now.

export const STATUSES = ["draft", "held", "finalized", "withdrawn", "rejected"] as const;
export const PAGE_SIZE = 25;

export const SORTS = ["newest", "oldest", "updated", "child_asc", "child_desc"] as const;
// Only these fixed ORDER BY texts are ever used; the client sends a name from the list above, never a column.
const ORDER: Record<(typeof SORTS)[number], string> = {
  newest: "s.created_at DESC, s.id DESC",
  oldest: "s.created_at ASC, s.id ASC",
  updated: "s.updated_at DESC, s.id DESC",
  child_asc: "s.child_name ASC, s.id ASC",
  child_desc: "s.child_name DESC, s.id DESC",
};

export const listQuery = z.strictObject({
  q: z.string().trim().min(1).max(80).optional(),
  sort: z.enum(SORTS).optional(),
  video: z.enum(["uploaded", "none"]).optional(),
  duplicate: z.literal("1").optional(),
  competition: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/u).max(60).optional(),
  status: z.enum(STATUSES).optional(),
  page: z.string().regex(/^[1-9][0-9]{0,5}$/u).transform(Number).optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

const editName = z.string().max(400, { message: "too_long" }).transform((raw) => parseName(raw) ?? raw).refine((value) => parseName(value) !== null, { message: "invalid_name" });
const editMobile = z.string().max(40, { message: "invalid_mobile" }).transform((raw) => parseMobile(raw) ?? raw).refine((value) => parseMobile(value) !== null, { message: "invalid_mobile" });
const editEmail = z.union([
  z.null(),
  z.string().max(254, { message: "invalid_email" }).transform(cleanEmail).refine((value) => value === null || z.email().safeParse(value).success, { message: "invalid_email" }),
]);
export const editBody = z.strictObject({
  childName: editName,
  childAge: z.number({ message: "invalid_age" }).int({ message: "invalid_age" }).min(1, { message: "out_of_range" }).max(18, { message: "out_of_range" }),
  guardianName: editName,
  guardianMobile: editMobile,
  guardianEmail: editEmail,
});
export type AdminEditInput = z.infer<typeof editBody>;

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
  /** True when the entry has its one checked video (an upload that was started but not finished does not count). */
  hasVideo: boolean;
  openDuplicateFlag: boolean;
  createdAt: string;
  updatedAt: string;
};
export type RegistrationList = { registrations: RegistrationRow[]; total: number; page: number; pageSize: number };

export const deletedListQuery = z.strictObject({
  q: z.string().trim().min(1).max(80).optional(),
  page: z.string().regex(/^[1-9][0-9]{0,5}$/u).transform(Number).optional(),
});
export type DeletedListQuery = z.infer<typeof deletedListQuery>;

export type DeletedRegistrationRow = {
  entryCode: string;
  status: string;
  competitionSlug: string;
  competitionNameTa: string;
  competitionNameEn: string;
  childName: string;
  childAge: number;
  guardianName: string;
  deletedAt: string;
  deletedBy: string | null;
};
export type DeletedRegistrationList = { registrations: DeletedRegistrationRow[]; total: number; page: number; pageSize: number };

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
  if (query.video) where.push(`${query.video === "none" ? "NOT " : ""}EXISTS (SELECT 1 FROM video_uploads v WHERE v.submission_id = s.id AND v.status = 'verified')`);
  if (query.duplicate) where.push("EXISTS (SELECT 1 FROM duplicate_reviews d WHERE d.submission_id = s.id AND d.status IN ('held', 'flagged'))");
  if (query.q) {
    // Entry code, child name or guardian name. LIKE wildcards typed by the user are escaped so they match themselves.
    const like = `%${query.q.replace(/[!%_]/gu, (ch) => `!${ch}`)}%`;
    where.push("(s.entry_code LIKE ? ESCAPE '!' OR s.child_name LIKE ? ESCAPE '!' OR s.guardian_name LIKE ? ESCAPE '!')");
    params.push(like, like, like);
  }
  const filter = `WHERE s.deleted_at IS NULL${where.length > 0 ? ` AND ${where.join(" AND ")}` : ""}`;
  const page = query.page ?? 1;
  // The count and the page are independent reads, so they run together.
  const totalQuery = db.query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM submissions s JOIN events e ON e.id = s.event_id ${filter}`, params);
  // page and PAGE_SIZE are validated integers, so they are written into the statement (a bound LIMIT is not accepted by every MySQL-protocol server).
  const rowsQuery =
    db.query<{
      entry_code: string; status: string; slug: string; name_ta: string; name_en: string; version: unknown; child_name: string; child_age: unknown; guardian_name: string;
      answered: unknown; video: unknown; dup: unknown; created_at: unknown; updated_at: unknown;
    }>(
      `SELECT s.entry_code, s.status, e.slug, e.name_ta, e.name_en, qs.version, s.child_name, s.child_age, s.guardian_name, s.created_at, s.updated_at,
         (SELECT COUNT(*) FROM entry_answers a WHERE a.submission_id = s.id) AS answered,
         (SELECT COUNT(*) FROM video_uploads v WHERE v.submission_id = s.id AND v.status = 'verified') AS video,
         (SELECT COUNT(*) FROM duplicate_reviews d WHERE d.submission_id = s.id AND d.status IN ('held', 'flagged')) AS dup
       FROM submissions s JOIN events e ON e.id = s.event_id JOIN question_sets qs ON qs.id = s.question_set_id ${filter}
       ORDER BY ${ORDER[query.sort ?? "newest"]} LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      params,
    );
  const [totalResult, rowsResult] = await Promise.all([totalQuery, rowsQuery]);
  const total = n(totalResult.rows[0]?.n);
  const rows = rowsResult.rows;
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
      hasVideo: n(r.video) > 0,
      openDuplicateFlag: n(r.dup) > 0,
      createdAt: asDate(r.created_at).toISOString(),
      updatedAt: asDate(r.updated_at).toISOString(),
    })),
  };
}

/** Deleted drafts are a separate, Super Admin-only query. Normal registration reads never include them. */
export async function listDeletedRegistrations(db: Queryable, query: DeletedListQuery): Promise<DeletedRegistrationList> {
  const where: string[] = ["s.deleted_at IS NOT NULL"];
  const params: string[] = [];
  if (query.q) {
    const like = `%${query.q.replace(/[!%_]/gu, (ch) => `!${ch}`)}%`;
    where.push("(s.entry_code LIKE ? ESCAPE '!' OR s.child_name LIKE ? ESCAPE '!' OR s.guardian_name LIKE ? ESCAPE '!')");
    params.push(like, like, like);
  }
  const filter = `WHERE ${where.join(" AND ")}`;
  const page = query.page ?? 1;
  const totalQuery = db.query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM submissions s ${filter}`, params);
  const rowsQuery = db.query<{
    entry_code: string; status: string; slug: string; name_ta: string; name_en: string; child_name: string; child_age: unknown; guardian_name: string; deleted_at: unknown; deleted_by: string | null;
  }>(
    `SELECT s.entry_code, s.status, e.slug, e.name_ta, e.name_en, s.child_name, s.child_age, s.guardian_name, s.deleted_at,
       (SELECT u.display_name FROM audit_log a LEFT JOIN staff_users u ON u.id = a.actor_staff_id
        WHERE a.action = 'registration.deleted' AND a.entity_type = 'submission' AND a.entity_id = s.id ORDER BY a.id DESC LIMIT 1) AS deleted_by
     FROM submissions s JOIN events e ON e.id = s.event_id ${filter}
     ORDER BY s.deleted_at DESC, s.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params,
  );
  const [totalResult, rowsResult] = await Promise.all([totalQuery, rowsQuery]);
  const total = n(totalResult.rows[0]?.n);
  const rows = rowsResult.rows;
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
      childName: r.child_name,
      childAge: n(r.child_age),
      guardianName: r.guardian_name,
      deletedAt: asDate(r.deleted_at).toISOString(),
      deletedBy: r.deleted_by,
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
  /** The entry's one checked video, if any: size, type and when it was checked. Never an object key or a URL. */
  video: { uploaded: boolean; bytes: number | null; contentType: string | null; uploadedAt: string | null };
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
       FROM submissions s JOIN events e ON e.id = s.event_id JOIN question_sets qs ON qs.id = s.question_set_id WHERE s.entry_code = ? AND s.deleted_at IS NULL`,
      [entryCode],
    )
  ).rows[0];
  if (!s) throw new AppError(404, "not_found", "Not found.");
  const id = n(s.id);

  // The answers, the duplicate reviews, the video and the audit row do not depend on each other: they are issued together. The audit write is
  // still awaited before anything is returned, so a failed audit write fails the read.
  const answerQuery = db.query<{ k: string; type: string; position: unknown; prompt_ta: string; prompt_en: string; required: unknown; options_json: unknown; value_text: string | null; value_number: unknown; value_json: unknown; has: unknown }>(
      `SELECT q.question_key AS k, q.type, q.position, q.prompt_ta, q.prompt_en, q.required, q.options_json, a.value_text, a.value_number, a.value_json, a.id AS has
       FROM questions q LEFT JOIN entry_answers a ON a.question_id = q.id AND a.submission_id = ? WHERE q.question_set_id = ? ORDER BY q.position`,
      [id, n(s.question_set_id)],
    );
  const duplicatesQuery = db.query<{ status: string; reason: string; matched: string | null }>(
    `SELECT d.status, d.reason, m.entry_code AS matched FROM duplicate_reviews d LEFT JOIN submissions m ON m.id = d.matched_submission_id WHERE d.submission_id = ? ORDER BY d.id`,
    [id],
  );
  const videoQuery = db.query<{ verified_bytes: unknown; content_type: string; verified_at: unknown }>("SELECT verified_bytes, content_type, verified_at FROM video_uploads WHERE submission_id = ? AND status = 'verified'", [id]);
  const [answerResult, duplicatesResult, videoResult] = await Promise.all([
    answerQuery,
    duplicatesQuery,
    videoQuery,
    writeAudit(db, now, { actorType: "staff", actorStaffId: actor.staffId, action: "registration.viewed", entityType: "submission", entityId: id, requestId: actor.requestId }),
  ]);
  const answerRows = answerResult.rows;
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

  const duplicates = duplicatesResult.rows;
  const video = videoResult.rows[0];

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
    video: video ? { uploaded: true, bytes: n(video.verified_bytes), contentType: video.content_type, uploadedAt: isoOrNull(video.verified_at) } : { uploaded: false, bytes: null, contentType: null, uploadedAt: null },
    duplicates: duplicates.map((d) => ({ status: d.status, reason: d.reason, matchedEntryCode: d.matched })),
    createdAt: asDate(s.created_at).toISOString(),
    updatedAt: asDate(s.updated_at).toISOString(),
  };
}

export type AdminRegistrationUpdate = {
  entryCode: string;
  childName: string;
  childAge: number;
  guardianName: string;
  guardianMobile: string;
  guardianEmail: string | null;
  updatedAt: string;
};

const registrationProtected = () => new AppError(409, "registration_protected", "This registration cannot be changed.");

export async function updateRegistrationByAdmin(
  db: DatabaseAdapter,
  now: Date,
  actor: { staffId: number; requestId: string },
  entryCode: string,
  input: AdminEditInput,
): Promise<AdminRegistrationUpdate> {
  return db.transaction(async (tx) => {
    const lock = db.supportsRowLocks ? " FOR UPDATE" : "";
    const target = (await tx.query<{ id: unknown; entry_code: string; status: string; min_age: unknown; max_age: unknown; deleted_at: unknown }>(
      `SELECT s.id, s.entry_code, s.status, e.min_age, e.max_age, s.deleted_at
       FROM submissions s JOIN events e ON e.id = s.event_id WHERE s.entry_code = ?${lock}`,
      [entryCode],
    )).rows[0];
    if (!target || target.deleted_at !== null && target.deleted_at !== undefined) throw new AppError(404, "not_found", "Not found.");
    if (target.status !== "draft") throw registrationProtected();
    if (input.childAge < Number(target.min_age) || input.childAge > Number(target.max_age)) {
      throw new AppError(422, "validation_failed", "Some details need to be corrected.");
    }
    const updatedAt = now;
    const result = await tx.query(
      `UPDATE submissions
       SET child_name = ?, child_name_norm = ?, child_age = ?, guardian_name = ?, guardian_mobile = ?, guardian_email = ?, updated_at = ?
       WHERE id = ? AND status = 'draft' AND deleted_at IS NULL`,
      [input.childName, nameKey(input.childName), input.childAge, input.guardianName, input.guardianMobile, input.guardianEmail, updatedAt, Number(target.id)] as readonly SqlValue[],
    );
    if (result.affectedRows !== 1) throw registrationProtected();
    await writeAudit(tx, now, { actorType: "staff", actorStaffId: actor.staffId, action: "registration.updated", entityType: "submission", entityId: Number(target.id), requestId: actor.requestId });
    return { entryCode: target.entry_code, childName: input.childName, childAge: input.childAge, guardianName: input.guardianName, guardianMobile: input.guardianMobile, guardianEmail: input.guardianEmail, updatedAt: updatedAt.toISOString() };
  });
}

export async function deleteRegistrationByAdmin(
  db: DatabaseAdapter,
  now: Date,
  actor: { staffId: number; requestId: string },
  entryCode: string,
): Promise<{ ok: true }> {
  return db.transaction(async (tx) => {
    const lock = db.supportsRowLocks ? " FOR UPDATE" : "";
    const target = (await tx.query<{ id: unknown; status: string; deleted_at: unknown }>(
      `SELECT id, status, deleted_at FROM submissions WHERE entry_code = ?${lock}`,
      [entryCode],
    )).rows[0];
    if (!target || target.deleted_at !== null && target.deleted_at !== undefined) throw new AppError(404, "not_found", "Not found.");
    if (target.status !== "draft") throw registrationProtected();
    const result = await tx.query("UPDATE submissions SET deleted_at = ?, updated_at = ? WHERE id = ? AND status = 'draft' AND deleted_at IS NULL", [now, now, Number(target.id)]);
    if (result.affectedRows !== 1) throw registrationProtected();
    await writeAudit(tx, now, { actorType: "staff", actorStaffId: actor.staffId, action: "registration.deleted", entityType: "submission", entityId: Number(target.id), requestId: actor.requestId });
    return { ok: true };
  });
}

export async function restoreRegistrationByAdmin(
  db: DatabaseAdapter,
  now: Date,
  actor: { staffId: number; requestId: string },
  entryCode: string,
): Promise<{ ok: true }> {
  return db.transaction(async (tx) => {
    const lock = db.supportsRowLocks ? " FOR UPDATE" : "";
    const target = (await tx.query<{ id: unknown; event_id: unknown; status: string; child_name_norm: string; guardian_mobile: string; deleted_at: unknown }>(
      `SELECT id, event_id, status, child_name_norm, guardian_mobile, deleted_at FROM submissions WHERE entry_code = ?${lock}`,
      [entryCode],
    )).rows[0];
    if (!target || target.deleted_at === null || target.deleted_at === undefined) throw new AppError(404, "not_found", "Not found.");
    if (target.status !== "draft") throw registrationProtected();
    const conflict = (await tx.query(
      `SELECT 1 AS present FROM submissions
       WHERE id <> ? AND deleted_at IS NULL AND event_id = ? AND child_name_norm = ? AND guardian_mobile = ? AND status IN ('finalized', 'held') LIMIT 1`,
      [Number(target.id), Number(target.event_id), target.child_name_norm, target.guardian_mobile],
    )).rows.length > 0;
    if (conflict) throw new AppError(409, "registration_restore_conflict", "This registration conflicts with an existing submitted registration.");
    const result = await tx.query(
      "UPDATE submissions SET deleted_at = NULL, updated_at = ? WHERE id = ? AND status = 'draft' AND deleted_at IS NOT NULL",
      [now, Number(target.id)],
    );
    if (result.affectedRows !== 1) throw new AppError(409, "registration_restore_conflict", "This registration changed while it was being restored.");
    await writeAudit(tx, now, { actorType: "staff", actorStaffId: actor.staffId, action: "registration.restored", entityType: "submission", entityId: Number(target.id), requestId: actor.requestId });
    return { ok: true };
  });
}

/**
 * Permanent delete of one soft-deleted DRAFT, for the Super Admin. Nothing else can be purged: a submitted, scored or judged entry, an entry that
 * another entry's duplicate review points at, and an entry that is not already soft-deleted are all refused. Order matters: the stored video
 * objects are removed first (deleting a missing object is not an error), and only if that worked is the database transaction run. If storage
 * cannot be reached nothing is deleted. The audit row keeps only the entry reference and counts, never a name or a contact detail.
 */
export async function purgeRegistrationByAdmin(
  db: DatabaseAdapter,
  now: Date,
  actor: { staffId: number; requestId: string },
  entryCode: string,
  store: VideoStore | null,
): Promise<{ ok: true }> {
  const target = (await db.query<{ id: unknown; status: string; deleted_at: unknown }>("SELECT id, status, deleted_at FROM submissions WHERE entry_code = ?", [entryCode])).rows[0];
  if (!target || target.deleted_at === null || target.deleted_at === undefined) throw new AppError(404, "not_found", "Not found.");
  if (target.status !== "draft") throw registrationProtected();
  const id = Number(target.id);

  const tie = (await db.query<{ n: unknown }>(
    `SELECT (SELECT COUNT(*) FROM judge_assignments WHERE submission_id = ?)
          + (SELECT COUNT(*) FROM winners WHERE submission_id = ?)
          + (SELECT COUNT(*) FROM duplicate_reviews WHERE matched_submission_id = ? AND submission_id <> ?) AS n`,
    [id, id, id, id],
  )).rows[0];
  if (n(tie?.n) > 0) throw new AppError(409, "registration_purge_blocked", "Other records depend on this registration, so it cannot be permanently deleted.");

  const uploads = (await db.query<{ object_key: string }>("SELECT object_key FROM video_uploads WHERE submission_id = ?", [id])).rows;
  if (uploads.length > 0) {
    if (!store) throw new AppError(503, "storage_unavailable", "Video storage is not available, so the uploaded video cannot be removed. Nothing was deleted.");
    try {
      for (const upload of uploads) {
        await store.remove(pendingKey(upload.object_key));
        await store.remove(videoKey(upload.object_key));
      }
    } catch {
      throw new AppError(502, "storage_delete_failed", "The stored video could not be removed. Nothing was deleted.");
    }
  }

  return db.transaction(async (tx) => {
    const lock = db.supportsRowLocks ? " FOR UPDATE" : "";
    const again = (await tx.query<{ status: string; deleted_at: unknown }>(`SELECT status, deleted_at FROM submissions WHERE id = ?${lock}`, [id])).rows[0];
    if (!again || again.deleted_at === null || again.deleted_at === undefined || again.status !== "draft") throw registrationProtected();
    await tx.query("DELETE FROM duplicate_reviews WHERE submission_id = ?", [id]);
    await tx.query("DELETE FROM entry_answers WHERE submission_id = ?", [id]);
    await tx.query("DELETE FROM registration_recovery WHERE submission_id = ?", [id]);
    await tx.query("DELETE FROM email_outbox WHERE submission_id = ?", [id]);
    await tx.query("DELETE FROM video_uploads WHERE submission_id = ?", [id]);
    const gone = await tx.query("DELETE FROM submissions WHERE id = ? AND status = 'draft' AND deleted_at IS NOT NULL", [id]);
    if (gone.affectedRows !== 1) throw registrationProtected();
    await writeAudit(tx, now, { actorType: "staff", actorStaffId: actor.staffId, action: "registration.purged", entityType: "submission", entityId: id, requestId: actor.requestId, details: { entryCode, uploads: uploads.length } });
    return { ok: true as const };
  });
}

/** How long an administrator's playback link lives. The same five minutes as a judge's. */
export const ADMIN_PLAYBACK_SECONDS = 5 * 60;

/**
 * A short-lived signed link to the entry's checked video, for an administrator who opened that entry. The role was checked by the route; the
 * entry must exist, not be deleted, and have a verified video. The audit row is written BEFORE the link is signed, so a failed audit write
 * means no link. The bucket has no public domain: this link is the only way to the file.
 */
export async function mintAdminPlaybackUrl(
  db: Queryable,
  now: Date,
  actor: { staffId: number; requestId: string },
  entryCode: string,
  store: VideoStore | null,
): Promise<{ ok: true; url: string; expiresInSeconds: number }> {
  if (store === null) throw new AppError(503, "playback_unavailable", "Video playback is not available right now.");
  const row = (await db.query<{ id: unknown; object_key: string }>(
    `SELECT s.id, v.object_key FROM submissions s JOIN video_uploads v ON v.submission_id = s.id AND v.status = 'verified'
     WHERE s.entry_code = ? AND s.deleted_at IS NULL`,
    [entryCode],
  )).rows[0];
  if (!row) throw new AppError(404, "not_found", "No verified video found for this entry.");
  await writeAudit(db, now, { actorType: "staff", actorStaffId: actor.staffId, action: "registration.video_playback", entityType: "submission", entityId: Number(row.id), requestId: actor.requestId });
  const url = await store.presignGet(videoKey(String(row.object_key)), { expiresInSeconds: ADMIN_PLAYBACK_SECONDS });
  return { ok: true, url, expiresInSeconds: ADMIN_PLAYBACK_SECONDS };
}
