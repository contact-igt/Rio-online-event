import { z } from "zod";
import { writeAudit } from "../auth/audit.ts";
import type { DatabaseAdapter, Queryable } from "../db/adapter.ts";
import { DatabaseError } from "../db/errors.ts";
import { asDate } from "../db/values.ts";
import { AppError } from "../http/errors.ts";
import { loadRanking, type RankingRow } from "./scoring.ts";

// Winners, chosen by an administrator (brief M7: no automatic selection; ties are decided by a person). Approving a winner does NOT publish
// it: the public page shows winners only after the "Results published at" time in Event Settings has passed (the database view
// published_winners). Until then winners can be added and removed; from that moment they are frozen, here (with the app's clock) and in the
// database (its triggers, with the database clock). Only a finalized entry of the same competition can win; one place per entry and one
// entry per place. The public sees only the display name the administrator typed (meant to be a first name), the place and the award.
// Every change is audit-logged with ids and labels only, never a name.

export const MAX_PLACE = 10;
export const approveBody = z.strictObject({
  entryCode: z.string().regex(/^[A-Z0-9]{6,16}$/u, "invalid_entry"),
  place: z.number("invalid").int("invalid").min(1, "invalid_place").max(MAX_PLACE, "invalid_place"),
  displayName: z.string().transform((s) => s.normalize("NFC").replace(/\s+/gu, " ").trim()).pipe(
    z.string().min(1, "required").max(60, "too_long").refine((s) => !/[<>]/u.test(s), "unsafe_text"),
  ),
  awardLabel: z.string().transform((s) => s.normalize("NFC").replace(/\s+/gu, " ").trim()).pipe(
    z.string().max(80, "too_long").refine((s) => !/[<>]/u.test(s), "unsafe_text"),
  ).nullable().optional().transform((v) => (v ? v : null)),
  confirm: z.literal(true, "confirm_required"),
});

export type WinnerRow = { place: number; entryCode: string; childName: string; displayName: string; awardLabel: string | null; average: number | null; rank: number | null; approvedAt: string };
export type CompetitionWinners = {
  competition: { slug: string; nameTa: string; nameEn: string };
  publishAt: string | null;
  /** The publication time has passed: winners are public and can no longer change. */
  frozen: boolean;
  winners: WinnerRow[];
  /** Every submitted entry, in ranking order, to choose from (the ranking informs; the administrator decides). */
  candidates: RankingRow[];
};

const frozenError = () => new AppError(409, "results_frozen", "Results are published. Winners can no longer change.");
const notFound = () => new AppError(404, "not_found", "Not found.");

async function publishAt(db: Queryable): Promise<Date | null> {
  const v = (await db.query<{ results_publish_at: unknown }>("SELECT results_publish_at FROM event_settings WHERE id = 1")).rows[0]?.results_publish_at;
  return v === null || v === undefined ? null : asDate(v);
}
const isFrozen = (at: Date | null, now: Date) => at !== null && at.getTime() <= now.getTime();

export async function loadWinners(db: Queryable, now: Date, slug: string): Promise<CompetitionWinners> {
  const ranking = await loadRanking(db, slug); // 404 for an unknown competition
  const rows = (
    await db.query<{ place: unknown; entry_code: string; child_name: string; display_name: string; award_label: string | null; approved_at: unknown }>(
      `SELECT w.place, s.entry_code, s.child_name, w.display_name, w.award_label, w.approved_at
       FROM winners w JOIN submissions s ON s.id = w.submission_id JOIN events e ON e.id = w.event_id WHERE e.slug = ? ORDER BY w.place`,
      [slug],
    )
  ).rows;
  const at = await publishAt(db);
  return {
    competition: ranking.competition,
    publishAt: at?.toISOString() ?? null,
    frozen: isFrozen(at, now),
    winners: rows.map((r) => {
      const ranked = ranking.entries.find((e) => e.entryCode === r.entry_code);
      return {
        place: Number(r.place), entryCode: r.entry_code, childName: r.child_name, displayName: r.display_name, awardLabel: r.award_label,
        average: ranked?.average ?? null, rank: ranked?.rank ?? null, approvedAt: asDate(r.approved_at).toISOString(),
      };
    }),
    candidates: ranking.entries,
  };
}

type Actor = { staffId: number; requestId: string };

export async function approveWinner(db: DatabaseAdapter, now: Date, actor: Actor, slug: string, input: z.infer<typeof approveBody>): Promise<CompetitionWinners> {
  if (isFrozen(await publishAt(db), now)) throw frozenError();
  const event = (await db.query<{ id: unknown }>("SELECT id FROM events WHERE slug = ?", [slug])).rows[0];
  if (!event) throw notFound();
  const eventId = Number(event.id);
  const entry = (await db.query<{ id: unknown; status: string; event_id: unknown }>("SELECT id, status, event_id FROM submissions WHERE entry_code = ?", [input.entryCode])).rows[0];
  if (!entry || Number(entry.event_id) !== eventId) throw new AppError(404, "entry_not_found", "That entry is not in this competition.");
  if (entry.status !== "finalized") throw new AppError(409, "entry_not_finalized", "Only a submitted (finalized) entry can win.");
  const submissionId = Number(entry.id);
  if ((await db.query("SELECT 1 AS taken FROM winners WHERE event_id = ? AND place = ?", [eventId, input.place])).rows.length > 0) {
    throw new AppError(409, "place_taken", "That place already has a winner. Remove it first.");
  }
  if ((await db.query("SELECT 1 AS taken FROM winners WHERE submission_id = ?", [submissionId])).rows.length > 0) {
    throw new AppError(409, "already_winner", "This entry is already a winner.");
  }
  try {
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO winners (event_id, submission_id, place, award_label, display_name, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        eventId, submissionId, input.place, input.awardLabel, input.displayName, actor.staffId, now,
      ]);
      await writeAudit(tx, now, {
        actorType: "staff", actorStaffId: actor.staffId, action: "winner.approved", entityType: "submission", entityId: submissionId, requestId: actor.requestId,
        details: { competition: slug, place: input.place, award: input.awardLabel !== null },
      });
    });
  } catch (error) {
    if (error instanceof DatabaseError && error.constraint === "unique") throw new AppError(409, "place_taken", "That place or entry was just taken. Reload and try again.");
    if (error instanceof DatabaseError && error.constraint === "rule") throw frozenError();
    throw error;
  }
  return loadWinners(db, now, slug);
}

export async function removeWinner(db: DatabaseAdapter, now: Date, actor: Actor, slug: string, place: number): Promise<CompetitionWinners> {
  if (isFrozen(await publishAt(db), now)) throw frozenError();
  const row = (await db.query<{ id: unknown; submission_id: unknown }>("SELECT w.id, w.submission_id FROM winners w JOIN events e ON e.id = w.event_id WHERE e.slug = ? AND w.place = ?", [slug, place])).rows[0];
  if (!row) throw notFound();
  try {
    await db.transaction(async (tx) => {
      await tx.query("DELETE FROM winners WHERE id = ?", [Number(row.id)]);
      await writeAudit(tx, now, {
        actorType: "staff", actorStaffId: actor.staffId, action: "winner.removed", entityType: "submission", entityId: Number(row.submission_id), requestId: actor.requestId,
        details: { competition: slug, place },
      });
    });
  } catch (error) {
    if (error instanceof DatabaseError && error.constraint === "rule") throw frozenError();
    throw error;
  }
  return loadWinners(db, now, slug);
}

/** One line per active competition: winners chosen so far and whether results are public yet. */
export async function winnersOverview(db: Queryable, now: Date) {
  const at = await publishAt(db);
  const rows = (
    await db.query<{ slug: string; name_ta: string; name_en: string; winners: unknown; finalized: unknown }>(
      `SELECT e.slug, e.name_ta, e.name_en,
         (SELECT COUNT(*) FROM winners w WHERE w.event_id = e.id) AS winners,
         (SELECT COUNT(*) FROM submissions s WHERE s.event_id = e.id AND s.status = 'finalized') AS finalized
       FROM events e WHERE e.active = 1 ORDER BY e.display_order, e.id`,
    )
  ).rows;
  return {
    publishAt: at?.toISOString() ?? null,
    frozen: isFrozen(at, now),
    competitions: rows.map((r) => ({ slug: r.slug, nameTa: r.name_ta, nameEn: r.name_en, winners: Number(r.winners), finalized: Number(r.finalized) })),
  };
}
