import { z } from "zod";
import { writeAudit } from "../auth/audit.ts";
import type { DatabaseAdapter, Queryable } from "../db/adapter.ts";
import { asDate } from "../db/values.ts";
import { AppError } from "../http/errors.ts";
import { videoKey, type VideoStore } from "../storage/r2.ts";

export type AssignedEntryRow = {
  entryCode: string;
  competitionSlug: string;
  competitionNameTa: string;
  competitionNameEn: string;
  hasVideo: boolean;
  score: {
    marks: number | null;
    comments: string | null;
    status: "draft" | "final" | null;
    finalizedAt: string | null;
  } | null;
};

export type EntryReviewDetail = {
  entryCode: string;
  competition: {
    slug: string;
    nameTa: string;
    nameEn: string;
  };
  hasVideo: boolean;
  answers: {
    key: string;
    promptTa: string;
    promptEn: string;
    value: string | number | string[] | null;
  }[];
  score: {
    marks: number | null;
    comments: string | null;
    status: "draft" | "final" | null;
    finalizedAt: string | null;
  } | null;
};

export const saveScoreSchema = z.strictObject({
  marks: z
    .number()
    .min(0, "Marks must be between 0 and 10")
    .max(10, "Marks must be between 0 and 10")
    .nullable(),
  comments: z.string().max(2000).optional(),
  final: z.boolean(),
});

const n = (v: unknown): number => Number(v ?? 0);

export async function listAssignedEntries(db: Queryable, judgeId: number): Promise<{ entries: AssignedEntryRow[] }> {
  const result = await db.query<{
    entry_code: string;
    slug: string;
    name_ta: string;
    name_en: string;
    has_video: unknown;
    marks_hundredths: unknown;
    comments: string | null;
    score_status: string | null;
    finalized_at: unknown;
  }>(
    `
    SELECT
      s.entry_code,
      e.slug,
      e.name_ta,
      e.name_en,
      (SELECT COUNT(*) FROM video_uploads v WHERE v.submission_id = s.id AND v.status = 'verified') AS has_video,
      sc.marks_hundredths,
      sc.comments,
      sc.status AS score_status,
      sc.finalized_at
    FROM judge_assignments a
    JOIN submissions s ON s.id = a.submission_id
    JOIN events e ON e.id = s.event_id
    LEFT JOIN scores sc ON sc.judge_id = a.judge_id AND sc.submission_id = s.id
    WHERE a.judge_id = ?
    ORDER BY s.id ASC
    `,
    [judgeId],
  );

  const entries: AssignedEntryRow[] = result.rows.map((r) => {
    const rawMarks = r.marks_hundredths !== null && r.marks_hundredths !== undefined ? Number(r.marks_hundredths) : null;
    const marks = rawMarks !== null ? rawMarks / 100 : null;
    const status = r.score_status === "draft" || r.score_status === "final" ? r.score_status : null;
    return {
      entryCode: r.entry_code,
      competitionSlug: r.slug,
      competitionNameTa: r.name_ta,
      competitionNameEn: r.name_en,
      hasVideo: n(r.has_video) > 0,
      score: status
        ? {
            marks,
            comments: r.comments ?? null,
            status,
            finalizedAt: asDate(r.finalized_at)?.toISOString() ?? null,
          }
        : null,
    };
  });

  return { entries };
}

export async function getEntryForReview(db: Queryable, judgeId: number, entryCode: string): Promise<EntryReviewDetail> {
  const entryRes = await db.query<{
    id: unknown;
    entry_code: string;
    slug: string;
    name_ta: string;
    name_en: string;
    has_video: unknown;
    marks_hundredths: unknown;
    comments: string | null;
    score_status: string | null;
    finalized_at: unknown;
  }>(
    `
    SELECT
      s.id,
      s.entry_code,
      e.slug,
      e.name_ta,
      e.name_en,
      (SELECT COUNT(*) FROM video_uploads v WHERE v.submission_id = s.id AND v.status = 'verified') AS has_video,
      sc.marks_hundredths,
      sc.comments,
      sc.status AS score_status,
      sc.finalized_at
    FROM judge_assignments a
    JOIN submissions s ON s.id = a.submission_id
    JOIN events e ON e.id = s.event_id
    LEFT JOIN scores sc ON sc.judge_id = a.judge_id AND sc.submission_id = s.id
    WHERE a.judge_id = ? AND s.entry_code = ?
    `,
    [judgeId, entryCode],
  );

  if (entryRes.rows.length === 0) {
    throw new AppError(404, "not_found", "Assigned entry not found.");
  }

  const row = entryRes.rows[0]!;
  const submissionId = Number(row.id);

  // Load answers without revealing personal data
  const answersRes = await db.query<{
    question_key: string;
    prompt_ta: string;
    prompt_en: string;
    value_json: string;
  }>(
    `
    SELECT
      q.question_key,
      q.prompt_ta,
      q.prompt_en,
      a.value_json
    FROM entry_answers a
    JOIN questions q ON q.id = a.question_id
    WHERE a.submission_id = ?
    ORDER BY q.sort_order ASC
    `,
    [submissionId],
  );

  const answers = answersRes.rows.map((a) => {
    let parsedVal = null;
    try {
      parsedVal = JSON.parse(a.value_json);
    } catch {
      parsedVal = a.value_json;
    }
    return {
      key: a.question_key,
      promptTa: a.prompt_ta,
      promptEn: a.prompt_en,
      value: parsedVal,
    };
  });

  const rawMarks = row.marks_hundredths !== null && row.marks_hundredths !== undefined ? Number(row.marks_hundredths) : null;
  const marks = rawMarks !== null ? rawMarks / 100 : null;
  const status = row.score_status === "draft" || row.score_status === "final" ? row.score_status : null;

  return {
    entryCode: row.entry_code,
    competition: {
      slug: row.slug,
      nameTa: row.name_ta,
      nameEn: row.name_en,
    },
    hasVideo: n(row.has_video) > 0,
    answers,
    score: status
      ? {
          marks,
          comments: row.comments ?? null,
          status,
          finalizedAt: asDate(row.finalized_at)?.toISOString() ?? null,
        }
      : null,
  };
}

export const PLAYBACK_SECONDS = 5 * 60;

export async function mintPlaybackUrl(
  db: Queryable,
  now: Date,
  actor: { judgeId: number; requestId: string },
  entryCode: string,
  store: VideoStore | null,
): Promise<{ ok: true; url: string; expiresInSeconds: number }> {
  if (store === null) throw new AppError(503, "playback_unavailable", "Video playback is not available right now.");
  const result = await db.query<{
    id: unknown;
    object_key: string;
  }>(
    `
    SELECT s.id, v.object_key
    FROM judge_assignments a
    JOIN submissions s ON s.id = a.submission_id
    JOIN video_uploads v ON v.submission_id = s.id AND v.status = 'verified'
    WHERE a.judge_id = ? AND s.entry_code = ?
    `,
    [actor.judgeId, entryCode],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, "not_found", "No verified video found for this entry.");
  }

  const submissionId = Number(result.rows[0]?.id);
  const objectKey = result.rows[0]?.object_key;

  await writeAudit(db, now, {
    actorType: "staff",
    actorStaffId: actor.judgeId,
    action: "judge.video_playback",
    entityType: "submission",
    entityId: submissionId,
    requestId: actor.requestId,
  });

  // A presigned GET of the checked copy (videos/<key>) from the private bucket, valid for five minutes. The bucket has no public domain, so
  // this URL is the only way to the video, and it is minted only after the assignment check above and the audit row.
  const url = await store.presignGet(videoKey(String(objectKey)), { expiresInSeconds: PLAYBACK_SECONDS });
  return { ok: true, url, expiresInSeconds: PLAYBACK_SECONDS };
}

export async function saveScore(
  db: DatabaseAdapter,
  now: Date,
  actor: { judgeId: number; requestId: string },
  entryCode: string,
  input: { marks: number | null; comments?: string | undefined; final: boolean },
): Promise<{ ok: true; status: "draft" | "final"; marks: number | null }> {
  const assignRes = await db.query<{ id: unknown }>(
    `
    SELECT s.id
    FROM judge_assignments a
    JOIN submissions s ON s.id = a.submission_id
    WHERE a.judge_id = ? AND s.entry_code = ?
    `,
    [actor.judgeId, entryCode],
  );

  if (assignRes.rows.length === 0) {
    throw new AppError(404, "not_found", "Entry not assigned to this judge.");
  }
  const submissionId = Number(assignRes.rows[0]?.id);

  if (input.final && input.marks === null) {
    throw new AppError(400, "marks_required", "A final score requires marks between 0 and 10.");
  }

  const existingScore = await db.query<{ id: unknown; status: string }>(
    "SELECT id, status FROM scores WHERE judge_id = ? AND submission_id = ?",
    [actor.judgeId, submissionId],
  );

  if (existingScore.rows.length > 0 && existingScore.rows[0]?.status === "final") {
    throw new AppError(403, "score_locked", "This score has already been finalized and locked.");
  }

  const marksHundredths = input.marks !== null ? Math.round(input.marks * 100) : null;
  const status: "draft" | "final" = input.final ? "final" : "draft";
  const finalizedAt = input.final ? now : null;
  const comments = input.comments?.trim() || null;

  await db.transaction(async (tx) => {
    if (existingScore.rows.length > 0) {
      await tx.query(
        `
        UPDATE scores
        SET marks_hundredths = ?, comments = ?, status = ?, updated_at = ?, finalized_at = ?
        WHERE judge_id = ? AND submission_id = ?
        `,
        [marksHundredths, comments, status, now, finalizedAt, actor.judgeId, submissionId],
      );
    } else {
      await tx.query(
        `
        INSERT INTO scores (judge_id, submission_id, marks_hundredths, comments, status, created_at, updated_at, finalized_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [actor.judgeId, submissionId, marksHundredths, comments, status, now, now, finalizedAt],
      );
    }

    await writeAudit(tx, now, {
      actorType: "staff",
      actorStaffId: actor.judgeId,
      action: input.final ? "judge.score_final" : "judge.score_draft",
      entityType: "score",
      entityId: submissionId,
      requestId: actor.requestId,
      details: { entryCode, status, marksHundredths },
    });
  });

  return { ok: true, status, marks: input.marks };
}

