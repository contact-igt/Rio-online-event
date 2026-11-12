import type { Metadata } from "next";
import Link from "next/link";
import { AssignJudgeForm } from "@/components/admin/assign-judge-form";
import { Icon } from "@/components/ui/icon";
import { loadJudgesList, loadRanking, loadScoringOverview } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "நடுவரை ஒதுக்கு · Assign Judges", robots: { index: false } };
export const dynamic = "force-dynamic";

// Every competition on one page: how many submitted entries still have no judge, which judges are already on it, and the form to assign a
// judge to all of its submitted entries (safe to repeat: only entries not yet assigned are added). The sidebar link used to open the
// dashboard unless a competition page was already open, so it looked as if nothing happened.
export default async function AdminAssignPage() {
  await requireStaff("admin");
  const [overview, judgesRes] = await Promise.all([loadScoringOverview(), loadJudgesList()]);
  const judges = judgesRes.ok ? judgesRes.data.filter((j) => j.active).map((j) => ({ id: String(j.id), name: `${j.name} (${j.judgeCode})` })) : [];
  const rankings = overview.ok ? await Promise.all(overview.data.competitions.map((c) => loadRanking(c.slug))) : [];

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6 lg:px-8">
      <h1 className="text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold">
        Assign Judges
        <span lang="ta" className="block text-[0.6em] font-bold text-rio-slate">நடுவரை ஒதுக்கு</span>
      </h1>
      <p className="mt-2 max-w-[65ch] text-rio-slate">
        Assigning a judge gives them every submitted entry of that competition. Entries submitted later need assigning again; doing it twice
        never duplicates anything.
        <span lang="ta" className="block">பின்னர் சமர்ப்பிக்கப்படும் பதிவுகளுக்கு மீண்டும் ஒதுக்கவும்.</span>
      </p>

      {judgesRes.ok && judges.length === 0 && (
        <p role="status" className="mt-4 flex items-start gap-3 rounded-2xl border border-rio-navy/10 bg-white p-3 font-semibold text-rio-navy">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            No active judge yet. Add one on the Judges page first.
            <Link href="/admin/judges" className="ml-1 inline-flex min-h-11 items-center text-rio-rose underline underline-offset-2">Judges / நடுவர்கள்</Link>
          </span>
        </p>
      )}

      {!overview.ok || !judgesRes.ok ? (
        <p role="alert" className="mt-6 flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-3 font-semibold text-rio-error">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            The competitions or judges could not be loaded. Reload to try again.
            <span lang="ta" className="mt-1 block font-medium">ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள்.</span>
          </span>
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 lg:grid-cols-2">
          {overview.data.competitions.map((c, i) => {
            const ranking = rankings[i];
            const onIt = ranking?.ok ? [...new Map(ranking.data.entries.flatMap((e) => e.judges).map((j) => [j.judgeCode, j.judgeName])).values()] : [];
            return (
              <li key={c.slug} className="card p-4 sm:p-6">
                <h2 className="font-display text-2xl font-bold text-rio-navy">
                  <span lang="ta">{c.nameTa}</span> <span className="block text-base font-semibold text-rio-slate">{c.nameEn}</span>
                </h2>
                <p className="mt-2 font-semibold text-rio-navy">
                  {c.submitted} submitted · {c.notAssigned} without a judge
                </p>
                <p className="text-sm text-rio-slate">Judges on it: {onIt.length > 0 ? onIt.join(", ") : "none yet"}</p>
                <div className="mt-4">
                  {c.submitted === 0 ? (
                    <p className="text-rio-slate">No submitted entries yet. Assign once parents have submitted. <span lang="ta" className="block">இன்னும் சமர்ப்பிக்கப்பட்ட பதிவுகள் இல்லை.</span></p>
                  ) : (
                    <AssignJudgeForm slug={c.slug} judges={judges} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
