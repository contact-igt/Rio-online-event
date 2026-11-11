import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeAudit } from "../auth/audit.ts";
import { DatabaseError } from "../db/errors.ts";
import { asDate } from "../db/values.ts";
import { AppError } from "../http/errors.ts";
import { pendingKey, videoKey, type VideoStore } from "../storage/r2.ts";
import { ValidationFailed } from "./schemas.ts";
import { closed, isOpen, limit, loadSettings, notEditable, uploadsAvailable, type Access, type RegistrationDeps } from "./service.ts";

// A parent's one video, straight from the browser to the private bucket. The owner's rules (2026-11-11):
//   * ONE video per entry, final: once a video is checked and attached it cannot be replaced. An upload that failed or was interrupted can be
//     started again, as long as no video is attached yet.
//   * at most 50 MB, mp4, mov (quicktime) or webm; the upload URL is valid for 10 minutes; a single PUT (no multipart).
//
//   start     checks the declaration, the window, the entry (a draft without a video), gives up any earlier unfinished upload, records a new
//             one and signs a PUT for pending/<uuid>. The browser gets the URL and the uuid, never a bucket credential.
//   complete  finds the upload by uuid AND the parent's own entry (anybody else's id is "not found"), looks at the stored object, checks it is
//             exactly what was declared, copies it to videos/<uuid> only if unchanged since it was looked at, and attaches it. The database
//             keeps at most one checked video per entry (unique key), so two racing completions cannot both attach.
//
// Nothing here writes a name, a code, an object key or a URL into the audit log, the logs or an error.

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MIN_VIDEO_BYTES = 100 * 1024; // the database's own floor: anything smaller cannot be 30 seconds of video
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const UPLOAD_URL_SECONDS = 10 * 60;
/** How long after the URL expires the parent may still report the upload done (a PUT that started in time may finish late). */
const COMPLETE_GRACE_MS = 15 * 60_000;
export const VIDEO_LIMITS = { startsPerEntry: { max: 10, windowMs: 60 * 60_000 } } as const;

export const startBody = z.strictObject({
  type: z.enum(VIDEO_TYPES, "unsupported_type"),
  bytes: z.number("invalid").int("invalid").min(MIN_VIDEO_BYTES, "too_small").max(MAX_VIDEO_BYTES, "too_big"),
});
export const uploadIdSchema = z.uuid();

const unavailableUploads = () => new AppError(503, "uploads_unavailable", "Video uploads are not available right now.");
const alreadyUploaded = () => new AppError(409, "video_already_uploaded", "This entry already has its video. It cannot be replaced.");
const uploadNotFound = () => new AppError(404, "upload_not_found", "That upload was not found. Start the upload again.");
const uploadNotCurrent = () => new AppError(409, "upload_not_current", "That upload is no longer valid. Start the upload again.");
const uploadExpired = () => new AppError(409, "upload_expired", "That upload took too long. Start the upload again.");
const uploadMissing = () => new AppError(409, "upload_missing", "The video has not arrived yet. Upload it again.");
const uploadMismatch = (problem: string) => new ValidationFailed([{ field: "video", problem }]);

type Ctx = { requestId: string };
type EntryState = { status: string; eventId: number };

async function entryOf(deps: RegistrationDeps, access: Access): Promise<EntryState> {
  const row = (await deps.db.query<{ status: string; event_id: number | string }>("SELECT status, event_id FROM submissions WHERE id = ?", [access.submissionId])).rows[0];
  if (!row) throw notEditable();
  return { status: row.status, eventId: Number(row.event_id) };
}

/** Uploads on, registration open, the entry still a draft: the same checks for start and complete. Returns the bucket. */
async function openFor(deps: RegistrationDeps, access: Access): Promise<VideoStore> {
  if (!uploadsAvailable(deps) || deps.video === null) throw unavailableUploads();
  if (!isOpen(await loadSettings(deps.db), deps.now())) throw closed();
  if ((await entryOf(deps, access)).status !== "draft") throw notEditable();
  return deps.video;
}

const hasVideo = async (deps: RegistrationDeps, submissionId: number) =>
  (await deps.db.query("SELECT 1 AS present FROM video_uploads WHERE submission_id = ? AND status = 'verified'", [submissionId])).rows.length > 0;

export type Started = { uploadId: string; url: string; contentType: string; expiresAt: string };

export async function startVideoUpload(deps: RegistrationDeps, access: Access, input: z.infer<typeof startBody>, ctx: Ctx): Promise<Started> {
  const store = await openFor(deps, access);
  await limit(deps, "registration.video.start", String(access.submissionId), VIDEO_LIMITS.startsPerEntry);
  if (await hasVideo(deps, access.submissionId)) throw alreadyUploaded();

  const now = deps.now();
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + UPLOAD_URL_SECONDS * 1000);
  try {
    await deps.db.transaction(async (tx) => {
      // An earlier unfinished upload of this entry is given up: only the newest URL may lead to an attached video.
      await tx.query("UPDATE video_uploads SET status = 'abandoned' WHERE submission_id = ? AND status = 'issued'", [access.submissionId]);
      await tx.query(
        "INSERT INTO video_uploads (submission_id, object_key, content_type, declared_bytes, status, issued_at, expires_at) VALUES (?, ?, ?, ?, 'issued', ?, ?)",
        [access.submissionId, id, input.type, input.bytes, now, expiresAt],
      );
      await writeAudit(tx, now, { actorType: "public", action: "registration.video_upload_started", entityType: "submission", entityId: access.submissionId, requestId: ctx.requestId, details: { type: input.type, bytes: input.bytes } });
    });
  } catch (error) {
    if (error instanceof DatabaseError && error.constraint === "rule") throw notEditable(); // submitted while this request was running
    throw error;
  }

  try {
    const url = await store.presignPut(pendingKey(id), { contentType: input.type, expiresInSeconds: UPLOAD_URL_SECONDS });
    return { uploadId: id, url, contentType: input.type, expiresAt: expiresAt.toISOString() };
  } catch {
    // Never leave a usable record behind without a URL.
    await deps.db.query("UPDATE video_uploads SET status = 'abandoned' WHERE object_key = ? AND status = 'issued'", [id]).catch(() => undefined);
    throw unavailableUploads();
  }
}

type UploadRow = { id: number | string; status: string; content_type: string; declared_bytes: number | string; expires_at: unknown };

export async function completeVideoUpload(deps: RegistrationDeps, access: Access, uploadId: string, ctx: Ctx) {
  const store = await openFor(deps, access);
  // The uuid AND the parent's own entry: an id of anybody else's upload is indistinguishable from one that does not exist.
  const row = (
    await deps.db.query<UploadRow>("SELECT id, status, content_type, declared_bytes, expires_at FROM video_uploads WHERE object_key = ? AND submission_id = ?", [uploadId, access.submissionId])
  ).rows[0];
  if (!row) throw uploadNotFound();
  if (row.status === "verified") return { alreadyAttached: true };
  if (row.status !== "issued") throw uploadNotCurrent();
  const now = deps.now();
  if (asDate(row.expires_at).getTime() + COMPLETE_GRACE_MS < now.getTime()) {
    await deps.db.query("UPDATE video_uploads SET status = 'abandoned' WHERE id = ? AND status = 'issued'", [Number(row.id)]);
    throw uploadExpired();
  }

  const reject = async (status: "rejected" | "abandoned") => {
    await deps.db.query("UPDATE video_uploads SET status = ? WHERE id = ? AND status = 'issued'", [status, Number(row.id)]).catch(() => undefined);
    await store.remove(pendingKey(uploadId)).catch(() => undefined);
    await store.remove(videoKey(uploadId)).catch(() => undefined);
  };

  // Only now look at the bucket, and only at the one object this upload names.
  let head;
  try {
    head = await store.head(pendingKey(uploadId));
  } catch {
    throw unavailableUploads();
  }
  if (!head || !head.etag) throw uploadMissing(); // not (fully) arrived: the record stays, the parent may try again or start afresh
  if (head.bytes > MAX_VIDEO_BYTES) {
    await reject("rejected");
    throw uploadMismatch("too_big");
  }
  if (head.bytes !== Number(row.declared_bytes) || head.contentType !== row.content_type) {
    await reject("rejected");
    throw uploadMismatch("mismatch");
  }

  // Copy only if the object is still the one just checked; the upload URL can never reach videos/.
  try {
    await store.copy(pendingKey(uploadId), videoKey(uploadId), head.etag);
  } catch {
    await reject("rejected");
    throw uploadMismatch("mismatch");
  }

  try {
    await deps.db.transaction(async (tx) => {
      const done = await tx.query(
        "UPDATE video_uploads SET status = 'verified', verified_at = ?, verified_bytes = ?, etag = ? WHERE id = ? AND status = 'issued'",
        [now, head.bytes, head.etag!.slice(0, 128), Number(row.id)],
      );
      if (done.affectedRows !== 1) throw uploadNotCurrent();
      await writeAudit(tx, now, { actorType: "public", action: "registration.video_uploaded", entityType: "submission", entityId: access.submissionId, requestId: ctx.requestId, details: { type: row.content_type, bytes: head.bytes } });
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    // The unique key on one checked video per entry, or the entry was submitted meanwhile: undo the copy and say what happened.
    await reject("rejected");
    if (error instanceof DatabaseError && error.constraint === "unique") throw alreadyUploaded();
    if (error instanceof DatabaseError && error.constraint === "rule") throw notEditable();
    throw error;
  }
  await store.remove(pendingKey(uploadId)).catch(() => undefined); // best effort; the lifecycle rule also empties pending/
  return { alreadyAttached: false };
}
