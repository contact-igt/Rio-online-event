import type { Queryable } from "../db/adapter.ts";
import { AppError } from "../http/errors.ts";
import { rankEntries } from "./ranking.ts";

// The administrator's view of judging: for one competition, every submitted entry with its judges' marks, the average and the rank; and a
// short overview of all competitions. Read only. Ranking follows ranking.ts: final marks only, an entry is ranked once EVERY assigned judge
// has finalized, and equal averages are flagged as a tie for a person to decide (never broken automatically). Held entries (a possible
// duplicate waiting for review) are counted but not ranked. Marks are judges' 0 to 10 scores, stored as hundredths.

export type JudgeMark = { judgeName: string; judgeCode: string; marks: number | null; status: "draft" | "final" | "none" };
export type RankingRow = {
  entryCode: string;
  childName: string;
  childAge: number;
  hasVideo: boolean;
  assigned: number;
  finalScores: number;
  drafts: number;
  complete: boolean;
  average: number | null;
  rank: number | null;
  tie: boolean;
  judges: JudgeMark[];
};
export type CompetitionRanking = {
  competition: { slug: string; nameTa: string; nameEn: string };
  entries: RankingRow[];
  summary: { submitted: number; ranked: number; waiting: number; notAssigned: number; ties: number; heldForReview: number };
};

const n = (v: unknown): number => Number(v ?? 0);

async function rankingFor(db: Queryable, event: { id: number; slug: string; nameTa: string; nameEn: string }): Promise<CompetitionRanking> {
  const entries = (
    await db.query<{ id: unknown; entry_code: string; child_name: string; child_age: unknown; has_video: unknown }>(
      `SELECT s.id, s.entry_code, s.child_name, s.child_age,
         (SELECT COUNT(*) FROM video_uploads v WHERE v.submission_id = s.id AND v.status = 'verified') AS has_video
       FROM submissions s WHERE s.event_id = ? AND s.status = 'finalized' ORDER BY s.id`,
      [event.id],
    )
  ).rows;
  const held = n((await db.query<{ c: unknown }>("SELECT COUNT(*) AS c FROM submissions WHERE event_id = ? AND status = 'held'", [event.id])).rows[0]?.c);
  const assignments = (
    await db.query<{ submission_id: unknown; judge_id: unknown; judge_name: string; judge_code: string }>(
      `SELECT a.submission_id, a.judge_id, u.display_name AS judge_name, p.judge_code
       FROM judge_assignments a JOIN staff_users u ON u.id = a.judge_id JOIN judge_profiles p ON p.user_id = a.judge_id
       WHERE a.event_id = ? ORDER BY p.judge_code`,
      [event.id],
    )
  ).rows;
  const scores = (
    await db.query<{ submission_id: unknown; judge_id: unknown; marks_hundredths: unknown; status: string }>(
      `SELECT sc.submission_id, sc.judge_id, sc.marks_hundredths, sc.status
       FROM scores sc JOIN submissions s ON s.id = sc.submission_id WHERE s.event_id = ?`,
      [event.id],
    )
  ).rows;

  const marksOf = (v: unknown) => (v === null || v === undefined ? null : n(v) / 100);
  const ranked = rankEntries(
    entries.map((e) => String(e.id)),
    assignments.map((a) => ({ submissionId: String(a.submission_id), judgeId: String(a.judge_id) })),
    scores.map((s) => ({ submissionId: String(s.submission_id), judgeId: String(s.judge_id), marks: marksOf(s.marks_hundredths), status: s.status === "final" ? "final" : "draft" })),
  );
  const byId = new Map(entries.map((e) => [String(e.id), e]));
  const rows: RankingRow[] = ranked.map((r) => {
    const e = byId.get(r.submissionId)!;
    const judges = assignments
      .filter((a) => String(a.submission_id) === r.submissionId)
      .map((a) => {
        const s = scores.find((x) => String(x.submission_id) === r.submissionId && String(x.judge_id) === String(a.judge_id));
        return { judgeName: a.judge_name, judgeCode: a.judge_code, marks: s ? marksOf(s.marks_hundredths) : null, status: s ? (s.status === "final" ? "final" : "draft") : "none" } as JudgeMark;
      });
    return {
      entryCode: e.entry_code, childName: e.child_name, childAge: n(e.child_age), hasVideo: n(e.has_video) > 0,
      assigned: r.assigned, finalScores: r.finalScores, drafts: r.drafts, complete: r.complete, average: r.average, rank: r.rank, tie: r.tie, judges,
    };
  });
  return {
    competition: { slug: event.slug, nameTa: event.nameTa, nameEn: event.nameEn },
    entries: rows,
    summary: {
      submitted: rows.length,
      ranked: rows.filter((r) => r.complete).length,
      waiting: rows.filter((r) => !r.complete && r.assigned > 0).length,
      notAssigned: rows.filter((r) => r.assigned === 0).length,
      ties: rows.filter((r) => r.tie).length,
      heldForReview: held,
    },
  };
}

type EventRow = { id: unknown; slug: string; name_ta: string; name_en: string };
const toEvent = (e: EventRow) => ({ id: n(e.id), slug: e.slug, nameTa: e.name_ta, nameEn: e.name_en });

export async function loadRanking(db: Queryable, slug: string): Promise<CompetitionRanking> {
  const event = (await db.query<EventRow>("SELECT id, slug, name_ta, name_en FROM events WHERE slug = ?", [slug])).rows[0];
  if (!event) throw new AppError(404, "not_found", "Not found.");
  return rankingFor(db, toEvent(event));
}

/** One line per active competition: how far judging has got. */
export async function scoringOverview(db: Queryable): Promise<{ competitions: (CompetitionRanking["summary"] & CompetitionRanking["competition"])[] }> {
  const events = (await db.query<EventRow>("SELECT id, slug, name_ta, name_en FROM events WHERE active = 1 ORDER BY display_order, id")).rows;
  const out = [];
  for (const e of events) {
    const r = await rankingFor(db, toEvent(e));
    out.push({ ...r.competition, ...r.summary });
  }
  return { competitions: out };
}
