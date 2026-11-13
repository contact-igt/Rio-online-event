import type { DatabaseAdapter, Queryable } from "../db/adapter.ts";
import { DatabaseError } from "../db/errors.ts";
import type { Logger } from "../logger.ts";
import { confirmationEmail } from "./confirmation.ts";
import type { Mailer } from "./resend.ts";

// Confirmation e-mails go through the email_outbox table (migration 0010), so a slow or failing mail service never slows down or undoes a
// submission, and a message is sent at most once per entry:
//
//   queue    inside the submission's own transaction, one row per entry (the unique key holds it), only when the entry has an e-mail address;
//   deliver  right after the submission, and again every minute for anything due: a row is claimed with a short lock, so two workers never
//            send the same row; a failure waits 1, 2, 4 ... up to 60 minutes and is given up after 8 tries; a refusal that cannot change (a
//            bad address) is given up at once. Resend's idempotency key (the reference) also stops a repeat on its side.
//
// The address is read from the entry when sending and is never copied into the outbox, a log line or an error.

const KIND = "participation";
const MAX_ATTEMPTS = 8;
const LOCK_MS = 2 * 60_000;
const BATCH = 20;
const backoffMs = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;

/** Queue the confirmation for a just-submitted entry. Call inside the submission's transaction. Nothing happens when there is no address. */
export async function queueConfirmation(tx: Queryable, submissionId: number, now: Date): Promise<void> {
  const row = (await tx.query<{ email: string | null }>("SELECT guardian_email AS email FROM submissions WHERE id = ?", [submissionId])).rows[0];
  if (!row?.email) return;
  if ((await tx.query("SELECT 1 AS queued FROM email_outbox WHERE submission_id = ? AND kind = ?", [submissionId, KIND])).rows.length > 0) return;
  try {
    await tx.query("INSERT INTO email_outbox (submission_id, kind, status, attempts, next_attempt_at, created_at) VALUES (?, ?, 'pending', 0, ?, ?)", [submissionId, KIND, now, now]);
  } catch (error) {
    if (!(error instanceof DatabaseError && error.constraint === "unique")) throw error; // queued by a parallel request: fine
  }
}

type Due = { id: number | string; submission_id: number | string; attempts: number | string };
type Entry = { entry_code: string; child_name: string; guardian_email: string | null; status: string; name_ta: string; name_en: string };

const DUE = "((status IN ('pending', 'failed') AND next_attempt_at <= ?) OR (status = 'sending' AND locked_until < ?))";

export type Notifier = { deliverDue(): Promise<number>; kick(): void };

export function createNotifier(deps: { db: DatabaseAdapter; mailer: Mailer; now: () => Date; logger: Logger }): Notifier {
  const { db, mailer, now, logger } = deps;
  let running: Promise<number> | null = null;

  async function finish(id: number, attempts: number, result: "sent" | "retry" | "give_up_transient" | "give_up_permanent") {
    const at = now();
    if (result === "sent") {
      await db.query("UPDATE email_outbox SET status = 'sent', sent_at = ?, attempts = ?, locked_until = NULL, last_error = NULL WHERE id = ?", [at, attempts, id]);
    } else if (result === "retry") {
      await db.query("UPDATE email_outbox SET status = 'failed', attempts = ?, next_attempt_at = ?, locked_until = NULL, last_error = 'transient' WHERE id = ?", [attempts, new Date(at.getTime() + backoffMs(attempts)), id]);
    } else {
      await db.query("UPDATE email_outbox SET status = 'abandoned', attempts = ?, locked_until = NULL, last_error = ? WHERE id = ?", [attempts, result === "give_up_permanent" ? "permanent" : "transient", id]);
    }
  }

  async function sendOne(row: Due): Promise<boolean> {
    const id = Number(row.id);
    const at = now();
    const claimed = await db.query(`UPDATE email_outbox SET status = 'sending', locked_until = ? WHERE id = ? AND ${DUE}`, [new Date(at.getTime() + LOCK_MS), id, at, at]);
    if (claimed.affectedRows !== 1) return false; // another worker has it
    const attempts = Number(row.attempts) + 1;
    const entry = (await db.query<Entry>(
      "SELECT s.entry_code, s.child_name, s.guardian_email, s.status, e.name_ta, e.name_en FROM submissions s JOIN events e ON e.id = s.event_id WHERE s.id = ? AND s.deleted_at IS NULL",
      [Number(row.submission_id)],
    )).rows[0];
    // Deleted, back to draft, or the address removed: nothing to confirm any more.
    if (!entry?.guardian_email || (entry.status !== "finalized" && entry.status !== "held")) {
      await finish(id, attempts, "give_up_permanent");
      return true;
    }
    const result = await mailer.send(confirmationEmail({ to: entry.guardian_email, reference: entry.entry_code, childName: entry.child_name, eventTa: entry.name_ta, eventEn: entry.name_en }));
    if (result.ok) await finish(id, attempts, "sent");
    else if (!result.retryable) await finish(id, attempts, "give_up_permanent");
    else await finish(id, attempts, attempts >= MAX_ATTEMPTS ? "give_up_transient" : "retry");
    logger.info("confirmation_email", { outboxId: id, outcome: result.ok ? "sent" : result.retryable ? "retry" : "refused" }); // ids only
    return result.ok;
  }

  async function deliverDue(): Promise<number> {
    const at = now();
    const due = (await db.query<Due>(`SELECT id, submission_id, attempts FROM email_outbox WHERE ${DUE} ORDER BY id LIMIT ${BATCH}`, [at, at])).rows;
    let sent = 0;
    for (const row of due) if (await sendOne(row)) sent++;
    return sent;
  }

  /** One pass at a time; a call while a pass runs shares it. */
  function run(): Promise<number> {
    running ??= deliverDue()
      .catch((error: unknown) => {
        logger.warn("confirmation_email_pass_failed", { error });
        return 0;
      })
      .finally(() => (running = null));
    return running;
  }

  return { deliverDue: run, kick: () => void run() };
}
