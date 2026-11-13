import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { loadRanking, type RankingRow } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "தரவரிசை · Ranking", robots: { index: false } };
export const dynamic = "force-dynamic";

// One competition's ranking, from GET /admin/competitions/:slug/ranking. The API ranks: the average of FINAL marks (0 to 10) once every
// assigned judge has finished; equal averages share a rank and are flagged as a tie for the administrator to decide; nothing is broken
// automatically. Unfinished and unassigned entries are listed apart, unranked. Read only.

const marks = (m: number | null | undefined) => (m === null || m === undefined ? "–" : m.toFixed(2));
const judgeState = { final: "final", draft: "draft", none: "not scored" } as const;
const total = (r: RankingRow) => (r.maxTotal ? `${marks(r.total)} / ${r.maxTotal}` : "–");

/** Each judge's mark out of 10 and their comment: the administrator reads why, not only how much. */
function JudgeMarks({ row }: { row: RankingRow }) {
  if (row.judges.length === 0) return <span className="text-sm text-rio-slate">No judge assigned / நடுவர் இல்லை</span>;
  return (
    <ul className="space-y-1.5">
      {row.judges.map((j) => (
        <li key={j.judgeCode} className="text-sm">
          <span className="font-semibold text-rio-navy">{j.judgeName}</span>{" "}
          <span className="tabular-nums text-rio-navy">{j.marks === null ? "–" : `${marks(j.marks)} / 10`}</span>{" "}
          <span className="text-rio-slate">({judgeState[j.status]})</span>
          {j.comments && <span className="mt-0.5 block whitespace-pre-wrap text-rio-slate [overflow-wrap:anywhere]">“{j.comments}”</span>}
        </li>
      ))}
    </ul>
  );
}

function Badges({ row }: { row: RankingRow }) {
  return (
    <>
      {row.tie && <span className="ml-2 rounded-full bg-rio-blush px-2 py-0.5 text-xs font-bold text-rio-rose">Tie: decide by hand / சமநிலை</span>}
      {!row.hasVideo && <span className="ml-2 rounded-full border border-rio-slate/30 px-2 py-0.5 text-xs font-bold text-rio-slate">No video</span>}
    </>
  );
}

const Entry = ({ row }: { row: RankingRow }) => (
  <span className="min-w-0 [overflow-wrap:anywhere]">
    <Link href={`/admin/registrations/${row.entryCode}`} className="inline-flex min-h-11 items-center font-mono font-bold text-rio-navy underline underline-offset-2">{row.entryCode}</Link>
    <span className="block font-semibold text-rio-navy">{row.childName}, {row.childAge}<Badges row={row} /></span>
  </span>
);

/** The leaderboard: highest average first (the API's order), equal averages share a rank. A table from tablet width, cards on a phone. */
function Leaderboard({ rows, ranked }: { rows: RankingRow[]; ranked: boolean }) {
  return (
    <>
      <table className="mt-3 hidden w-full border-collapse text-left md:table">
        <thead>
          <tr className="border-b border-rio-navy/15 text-xs font-bold uppercase tracking-wide text-rio-slate">
            <th scope="col" className="w-16 py-2 pr-3">Rank</th>
            <th scope="col" className="py-2 pr-3">Entry</th>
            <th scope="col" className="py-2 pr-3">Judges&apos; marks</th>
            <th scope="col" className="w-28 py-2 pr-3 text-right">Total</th>
            <th scope="col" className="w-28 py-2 text-right">Average</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rio-navy/10">
          {rows.map((r) => (
            <tr key={r.entryCode} className="align-top">
              <td className="py-3 pr-3 font-display text-2xl font-bold tabular-nums text-rio-navy">{ranked && r.rank !== null ? `#${r.rank}` : "–"}</td>
              <td className="py-3 pr-3"><Entry row={r} /></td>
              <td className="py-3 pr-3"><JudgeMarks row={r} /></td>
              <td className="py-3 pr-3 text-right tabular-nums text-rio-navy">{total(r)}</td>
              <td className="py-3 text-right"><strong className="font-display text-xl tabular-nums text-rio-navy">{marks(r.average)}</strong><span className="text-sm text-rio-slate"> / 10</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <ol className="mt-2 divide-y divide-rio-navy/10 md:hidden">
        {rows.map((r) => (
          <li key={r.entryCode} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-3">
            <span className="font-display text-2xl font-bold tabular-nums text-rio-navy">{ranked && r.rank !== null ? `#${r.rank}` : "–"}</span>
            <div className="min-w-0 space-y-2">
              <Entry row={r} />
              <p className="text-rio-navy">
                <strong className="font-display text-xl tabular-nums">{marks(r.average)}</strong><span className="text-sm text-rio-slate"> / 10 average · total {total(r)}</span>
              </p>
              <JudgeMarks row={r} />
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function Group({ title, ta, note, rows, ranked = false }: { title: string; ta: string; note?: string; rows: RankingRow[]; ranked?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div className="card mt-6 p-4 sm:p-6">
      <h2 className="font-display text-2xl font-bold text-rio-navy">{title} <span lang="ta" className="font-medium">/ {ta}</span></h2>
      {note && <p className="mt-1 text-sm text-rio-slate">{note}</p>}
      <Leaderboard rows={rows} ranked={ranked} />
    </div>
  );
}

export default async function AdminRankingPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireStaff("admin");
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) notFound();
  const loaded = await loadRanking(slug);
  if (!loaded.ok && loaded.reason === "not_found") notFound();

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <nav aria-label="Breadcrumb" className="text-sm text-rio-slate">
        <Link href="/admin/scoring" className="inline-flex min-h-11 items-center underline underline-offset-2">Scoring</Link> / Ranking
      </nav>
      {!loaded.ok ? (
        <p role="alert" className="mt-6 flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-3 font-semibold text-rio-error">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            The ranking could not be loaded. Reload to try again.
            <span lang="ta" className="mt-1 block font-medium">தரவரிசையை ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள்.</span>
          </span>
        </p>
      ) : (
        <>
          <p lang="en" className="eyebrow mt-2">
            <span aria-hidden="true" className="h-px w-8 bg-current" />
            Ranking
          </p>
          <h1 className="mt-2 text-[clamp(1.75rem,4vw,2rem)] font-bold leading-tight text-rio-navy">
            <span lang="ta" className="block">{loaded.data.competition.nameTa}</span>
            <span lang="en" className="mt-0.5 block text-base font-medium leading-snug text-rio-slate sm:text-lg">{loaded.data.competition.nameEn}</span>
          </h1>
          <p className="mt-2 max-w-[65ch] text-rio-slate">
            Average of the final marks (0 to 10). An entry is ranked once every assigned judge has submitted a final mark. Equal averages share a
            rank and are marked as a tie: decide those by hand. Drafts never count.
            <span lang="ta" className="block">இறுதி மதிப்பெண்களின் சராசரி (0 முதல் 10). சமநிலைகளை நீங்களே முடிவு செய்யுங்கள்.</span>
          </p>
          <p role="status" className="mt-3 font-semibold text-rio-navy">
            {loaded.data.summary.submitted} submitted · {loaded.data.summary.ranked} ranked · {loaded.data.summary.waiting} waiting for judges · {loaded.data.summary.notAssigned} not assigned
            {loaded.data.summary.ties > 0 ? ` · ${loaded.data.summary.ties} in a tie` : ""}
            {loaded.data.summary.heldForReview > 0 ? ` · ${loaded.data.summary.heldForReview} held for review (not ranked)` : ""}
          </p>
          {loaded.data.summary.submitted === 0 && (
            <p className="card mt-6 p-4 text-rio-slate">No submitted entries in this competition yet. <span lang="ta" className="block">இன்னும் சமர்ப்பிக்கப்பட்ட பதிவுகள் இல்லை.</span></p>
          )}
          <Group title="Leaderboard" ta="முன்னணிப் பட்டியல்" note="Highest average first. Each judge marks out of 10; the total is out of 10 for every judge on the entry." rows={loaded.data.entries.filter((r) => r.complete)} ranked />
          <Group title="Waiting for judges" ta="நடுவர்களுக்காகக் காத்திருக்கிறது" note="Not every assigned judge has submitted a final mark yet." rows={loaded.data.entries.filter((r) => !r.complete && r.assigned > 0)} />
          <Group title="Not assigned" ta="ஒதுக்கப்படவில்லை" note="Assign judges to this competition from its page; entries submitted after an assignment need assigning again." rows={loaded.data.entries.filter((r) => r.assigned === 0)} />
        </>
      )}
    </section>
  );
}
