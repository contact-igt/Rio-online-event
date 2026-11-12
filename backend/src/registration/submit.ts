import { z } from "zod";
import { writeAudit } from "../auth/audit.ts";
import type { Queryable } from "../db/adapter.ts";
import { DatabaseError } from "../db/errors.ts";
import { AppError } from "../http/errors.ts";
import { videoKey } from "../storage/r2.ts";
import { inspectVideo } from "./inspect.ts";
import { ValidationFailed } from "./schemas.ts";
import { closed, isOpen, limit, loadSettings, loadView, notEditable, uploadsAvailable, type Access, type RegistrationDeps, type RegistrationView } from "./service.ts";

// Final submission: the last step of the one-sitting registration (owner, 2026-11-11: details, then the video, then submit).
//
//   1. registration open, uploads and the bucket available, the entry still a draft (an already submitted entry answers the same as success);
//   2. guardian consent recorded, every required question answered, one checked video attached;
//   3. the stored video is still exactly the one that was checked (size, type, ETag), and a few small byte ranges show it really is an
//      MP4/MOV/WebM with a video track whose header declares 30 to 90 seconds (inspect.ts). A video that fails this is NOT acceptable, so it is
//      removed and the parent may upload a correct one; this is the only case in which an attached video goes away;
//   4. one transaction: the wording of every answer is copied into its snapshot (so a later question edit never changes what was answered),
//      and the entry becomes `finalized`, or `held` for an administrator when it matches an entry already submitted for the same child, mobile
//      number and competition. The parent sees the same "submitted" either way. The database's unique key on finalized entries and its
//      "needs a verified video" trigger hold even if this code is wrong.
//
// Nothing here writes a name, a mobile number, a code, an object key or a URL into the audit log, the logs or an error.

export const submitBody = z.strictObject({ confirm: z.literal(true, "confirm_required") });
export const SUBMIT_LIMITS = { perEntry: { max: 20, windowMs: 60 * 60_000 } } as const;

const unavailable = () => new AppError(503, "submission_unavailable", "Submitting is not available right now. Try again in a moment.");
const videoRequired = () => new AppError(409, "video_required", "Upload the video before you submit.");

type EntryRow = { status: string; event_id: number | string; child_name_norm: string; guardian_mobile: string; guardian_consent_at: unknown };
type VideoRow = { id: number | string; object_key: string; content_type: string; verified_bytes: number | string; etag: string | null };

/** What the parent saw for each answer, frozen at submission: the prompt in both languages and, for a choice, the chosen labels. */
async function snapshotAnswers(tx: Queryable, submissionId: number, view: RegistrationView): Promise<void> {
  const rows = (await tx.query<{ id: number | string; k: string }>("SELECT a.id, q.question_key AS k FROM entry_answers a JOIN questions q ON q.id = a.question_id WHERE a.submission_id = ?", [submissionId])).rows;
  for (const row of rows) {
    const q = view.questionSet.questions.find((x) => x.key === row.k);
    if (!q) continue;
    const value = view.answers[row.k];
    const codes = Array.isArray(value) ? value : typeof value === "string" && q.options ? [value] : [];
    const chosen = q.options ? q.options.filter((o) => codes.includes(o.code)).map((o) => ({ code: o.code, ta: o.ta, en: o.en })) : null;
    await tx.query("UPDATE entry_answers SET snapshot_json = ? WHERE id = ?", [JSON.stringify({ promptTa: q.promptTa, promptEn: q.promptEn, type: q.type, ...(chosen ? { chosen } : {}) }), Number(row.id)]);
  }
}

export async function submitRegistration(deps: RegistrationDeps, access: Access, ctx: { requestId: string }): Promise<RegistrationView> {
  if (!uploadsAvailable(deps) || deps.video === null) throw unavailable();
  const store = deps.video;
  if (!isOpen(await loadSettings(deps.db), deps.now())) throw closed();
  await limit(deps, "registration.submit", String(access.submissionId), SUBMIT_LIMITS.perEntry);

  const entry = (await deps.db.query<EntryRow>("SELECT status, event_id, child_name_norm, guardian_mobile, guardian_consent_at FROM submissions WHERE id = ? AND deleted_at IS NULL", [access.submissionId])).rows[0];
  if (!entry) throw notEditable();
  if (entry.status === "finalized" || entry.status === "held") return loadView(deps.db, access); // a repeated press: already done
  if (entry.status !== "draft") throw notEditable();

  const view = await loadView(deps.db, access);
  const problems: { field: string; problem: string }[] = [];
  if (entry.guardian_consent_at === null || entry.guardian_consent_at === undefined) problems.push({ field: "guardianConsent", problem: "required" });
  for (const key of view.missingRequired) problems.push({ field: `answers.${key}`, problem: "required" });
  if (problems.length > 0) throw new ValidationFailed(problems);

  const video = (await deps.db.query<VideoRow>("SELECT id, object_key, content_type, verified_bytes, etag FROM video_uploads WHERE submission_id = ? AND status = 'verified'", [access.submissionId])).rows[0];
  if (!video) throw videoRequired();
  const key = videoKey(video.object_key);

  // The checked copy must still be exactly what was checked, then a bounded look inside it.
  let inspection;
  try {
    const head = await store.head(key);
    if (!head || head.bytes !== Number(video.verified_bytes) || head.contentType !== video.content_type || (video.etag !== null && head.etag !== video.etag)) throw unavailable();
    inspection = await inspectVideo(video.content_type, head.bytes, (start, end) => store.readRange(key, start, end));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unavailable(); // the bucket failed: the parent can simply try again; the video is not blamed
  }
  if (!inspection.ok) {
    await deps.db.transaction(async (tx) => {
      await tx.query("UPDATE video_uploads SET status = 'deleted' WHERE id = ? AND status = 'verified'", [Number(video.id)]);
      await writeAudit(tx, deps.now(), { actorType: "public", action: "registration.video_refused", entityType: "submission", entityId: access.submissionId, requestId: ctx.requestId, details: { reason: inspection.reason } });
    });
    await store.remove(key).catch(() => undefined);
    const problem = { tooShort: "too_short", tooLong: "too_long", notVideo: "not_video", typeMismatch: "not_video", unreadable: "unreadable" }[inspection.reason];
    throw new ValidationFailed([{ field: "video", problem }]);
  }

  const now = deps.now();
  const eventId = Number(entry.event_id);
  const finish = (held: boolean) =>
    deps.db.transaction(async (tx) => {
      await snapshotAnswers(tx, access.submissionId, view);
      if (held && (await tx.query("SELECT 1 AS open FROM duplicate_reviews WHERE submission_id = ? AND status IN ('held', 'flagged')", [access.submissionId])).rows.length === 0) {
        const match = (await tx.query<{ id: number | string }>("SELECT id FROM submissions WHERE event_id = ? AND child_name_norm = ? AND guardian_mobile = ? AND status IN ('finalized', 'held') AND id <> ? ORDER BY id LIMIT 1", [eventId, entry.child_name_norm, entry.guardian_mobile, access.submissionId])).rows[0];
        await tx.query("INSERT INTO duplicate_reviews (event_id, submission_id, matched_submission_id, status, reason, created_at) VALUES (?, ?, ?, 'held', 'same_child_mobile_event', ?)", [eventId, access.submissionId, match ? Number(match.id) : null, now]);
      }
      const status = held ? "held" : "finalized";
      const done = await tx.query(
        `UPDATE submissions SET status = ?, submitted_at = ?, updated_at = ?${held ? "" : ", finalized_at = ?"} WHERE id = ? AND status = 'draft'`,
        held ? [status, now, now, access.submissionId] : [status, now, now, now, access.submissionId],
      );
      if (done.affectedRows !== 1) throw notEditable();
      await writeAudit(tx, now, { actorType: "public", action: "registration.submitted", entityType: "submission", entityId: access.submissionId, requestId: ctx.requestId, details: { outcome: status } });
    });

  // Held for review when this child was already flagged, or already has a submitted entry in this competition.
  const flagged = (await deps.db.query("SELECT 1 AS open FROM duplicate_reviews WHERE submission_id = ? AND status IN ('held', 'flagged')", [access.submissionId])).rows.length > 0;
  const earlier = (await deps.db.query("SELECT 1 AS present FROM submissions WHERE event_id = ? AND child_name_norm = ? AND guardian_mobile = ? AND status IN ('finalized', 'held') AND id <> ?", [eventId, entry.child_name_norm, entry.guardian_mobile, access.submissionId])).rows.length > 0;
  try {
    await finish(flagged || earlier);
  } catch (error) {
    // A finalized twin appeared between the check and the update: the database's unique key refused it, so hold this one instead.
    if (error instanceof DatabaseError && error.constraint === "unique") await finish(true);
    else if (error instanceof DatabaseError && error.constraint === "rule") throw notEditable();
    else throw error;
  }
  return loadView(deps.db, access);
}
