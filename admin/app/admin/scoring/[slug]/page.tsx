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

const marks = (m: number | null) => (m === null ? "–" : m.toFixed(2));
const judgeState = { final: "final", draft: "draft", none: "not scored" } as const;

function Judges({ row }: { row: RankingRow }) {
  if (row.judges.length === 0) return <span className="text-rio-slate">No judge assigned / நடுவர் இல்லை</span>;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {row.judges.map((j) => (
        <li key={j.judgeCode} className="text-sm text-rio-slate">
          <span className="font-semibold text-rio-navy">{j.judgeName}</span> {j.marks === null ? "" : marks(j.marks)} <span>({judgeState[j.status]})</span>
        </li>
      ))}
    </ul>
  );
}

function EntryRow({ row }: { row: RankingRow }) {
  return (
    <li className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,9rem)] sm:items-start">
      <span className="font-display text-2xl font-bold text-rio-navy tabular-nums" aria-label={row.rank === null ? "Not ranked" : `Rank ${row.rank}`}>
        {row.rank === null ? "–" : `#${row.rank}`}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <Link href={`/admin/registrations/${row.entryCode}`} className="inline-flex min-h-11 items-center font-mono font-bold text-rio-navy underline underline-offset-2">{row.entryCode}</Link>
        <span className="ml-2 font-semibold text-rio-navy">{row.childName}</span>, {row.childAge}
        {row.tie && <span className="ml-2 rounded-full bg-rio-blush px-2 py-0.5 text-xs font-bold text-rio-rose">Tie: decide by hand / சமநிலை</span>}
        {!row.hasVideo && <span className="ml-2 rounded-full border border-rio-slate/30 px-2 py-0.5 text-xs font-bold text-rio-slate">No video</span>}
        <span className="mt-1 block"><Judges row={row} /></span>
      </span>
      <span className="sm:text-right">
        <strong className="font-display text-xl text-rio-navy tabular-nums">{marks(row.average)}</strong>
        <span className="text-sm text-rio-slate"> / 10</span>
        <span className="block text-sm text-rio-slate">{row.finalScores} of {row.assigned} judges final</span>
      </span>
    </li>
  );
}

function Group({ title, ta, note, rows }: { title: string; ta: string; note?: string; rows: RankingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="card mt-6 p-4 sm:p-6">
      <h2 className="font-display text-2xl font-bold text-rio-navy">{title} <span lang="ta" className="font-medium">/ {ta}</span></h2>
      {note && <p className="mt-1 text-sm text-rio-slate">{note}</p>}
      <ol className="mt-2 divide-y divide-rio-navy/10">{rows.map((r) => <EntryRow key={r.entryCode} row={r} />)}</ol>
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
    <section className="mx-auto w-full max-w-[1200px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6 lg:px-8">
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
          <h1 className="mt-2 text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold">
            <span lang="ta">{loaded.data.competition.nameTa}</span>
            <span className="block text-[0.6em] font-bold text-rio-slate">{loaded.data.competition.nameEn} · Ranking</span>
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
          <Group title="Ranking" ta="தரவரிசை" rows={loaded.data.entries.filter((r) => r.complete)} />
          <Group title="Waiting for judges" ta="நடுவர்களுக்காகக் காத்திருக்கிறது" note="Not every assigned judge has submitted a final mark yet." rows={loaded.data.entries.filter((r) => !r.complete && r.assigned > 0)} />
          <Group title="Not assigned" ta="ஒதுக்கப்படவில்லை" note="Assign judges to this competition from its page; entries submitted after an assignment need assigning again." rows={loaded.data.entries.filter((r) => r.assigned === 0)} />
        </>
      )}
    </section>
  );
}
