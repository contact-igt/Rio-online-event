import type { Metadata } from "next";
import { AssignJudgeForm } from "@/components/admin/assign-judge-form";
import { Icon } from "@/components/ui/icon";
import { loadCompetitions, loadJudgesList, loadRanking, loadScoringOverview } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "Assign Judges · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AssignJudgesPage() {
  await requireStaff("admin");
  const [competitions, judges, overview] = await Promise.all([loadCompetitions(), loadJudgesList(), loadScoringOverview()]);
  // A competition can have any number of judges: each Assign adds one judge to every submitted entry. Show who is already on each one, so a
  // second or third judge is plainly possible (the page used to show only the form, which read as "one judge per competition").
  const rankings = competitions.ok ? await Promise.all(competitions.data.map((c) => loadRanking(c.slug))) : [];
  const progress = (slug: string) => (overview.ok ? overview.data.competitions.find((c) => c.slug === slug) : undefined);
  const judgesOn = (i: number) => {
    const r = rankings[i];
    return r?.ok ? new Map(r.data.entries.flatMap((e) => e.judges).map((j) => [j.judgeCode, `${j.judgeName} (${j.judgeCode})`])) : new Map<string, string>();
  };
  const activeJudges = judges.ok ? judges.data.filter((judge) => judge.active).map((judge) => ({ id: String(judge.id), code: judge.judgeCode, name: `${judge.name} (${judge.judgeCode})` })) : [];

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <p lang="en" className="eyebrow">
        <span aria-hidden="true" className="h-px w-8 bg-current" />
        Judge assignment
      </p>
      <h1 className="mt-2 text-[clamp(1.75rem,4vw,2rem)] font-bold leading-tight text-rio-navy">
        <span lang="ta" className="block">நடுவர் ஒதுக்கீடு</span>
        <span lang="en" className="mt-0.5 block text-base font-medium leading-snug text-rio-slate sm:text-lg">Assign Judges</span>
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-rio-slate">Tick two or three judges for each competition and press Assign. Every ticked judge scores every submitted entry, and the ranking uses their average. Assigning is safe to repeat: press it again after new entries arrive.</p>

      {!competitions.ok && <p role="alert" className="card mt-6 p-4 font-semibold text-rio-error">Competition data is unavailable. No judge assignment was changed.</p>}

      {competitions.ok && (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-rio-rose/15 bg-rio-blush p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-rio-slate">Total competitions</p>
              <p className="mt-1 text-2xl font-extrabold text-rio-navy">{competitions.data.length}</p>
            </div>
            <div className="rounded-2xl border border-sky-200/70 bg-rio-mist p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-rio-slate">Active judges</p>
              <p className="mt-1 text-2xl font-extrabold text-rio-navy">{activeJudges.length}</p>
            </div>
          </div>

          {!judges.ok ? (
            <p role="alert" className="card mt-6 flex items-start gap-3 p-4 font-semibold text-rio-error sm:p-5">
              <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
              <span>Could not load active judges. No assignment control is shown until the judge list is available.</span>
            </p>
          ) : (
            <div className="card mt-6 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rio-blush text-rio-rose"><Icon name="users" className="h-5 w-5" /></span>
                <div>
                  <h2 className="text-lg font-semibold leading-snug text-rio-navy"><span lang="ta" className="block">நடுவர் ஒதுக்கீட்டு பணியிடம்</span><span lang="en" className="block text-sm font-medium text-rio-slate">Assignment workspace</span></h2>
                  <p className="mt-1 text-sm text-rio-slate">Tick the judges inside each competition card.</p>
                </div>
              </div>

              {competitions.data.length === 0 ? (
                <p className="mt-4 rounded-xl bg-rio-mist px-4 py-3 text-sm leading-snug text-rio-slate">No competitions are available yet. Add a competition before assigning judges.</p>
              ) : activeJudges.length === 0 ? (
                <p className="mt-4 rounded-xl bg-rio-mist px-4 py-3 text-sm leading-snug text-rio-slate">No active judges exist yet. Add judges before assigning them to a competition.</p>
              ) : (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {competitions.data.map((competition, i) => {
                    const p = progress(competition.slug);
                    const on = judgesOn(i);
                    const options = activeJudges.map((j) => ({ id: j.id, name: j.name, assigned: on.has(j.code) }));
                    return (
                      <article key={competition.slug} className="rounded-2xl border border-rio-navy/10 bg-white p-4 shadow-sm">
                        <h3 className="font-display text-xl font-bold leading-snug text-rio-navy">{competition.nameTa}<span lang="en" className="mt-0.5 block text-sm font-semibold text-rio-slate">{competition.nameEn}</span></h3>
                        {p && (
                          <p className="mt-2 text-sm font-semibold text-rio-navy">
                            {p.submitted} submitted · {p.notAssigned} without a judge
                            <span lang="ta" className="block font-medium text-rio-slate">{p.submitted} சமர்ப்பிப்புகள் · {p.notAssigned} நடுவர் இல்லாதவை</span>
                          </p>
                        )}
                        <div className="mt-2 rounded-xl bg-rio-mist px-3 py-2 text-sm text-rio-navy">
                          <span className="font-semibold">Judges on this competition / இந்தப் போட்டியின் நடுவர்கள்:</span>{" "}
                          {on.size > 0 ? [...on.values()].join(", ") : <span className="text-rio-slate">none yet / இன்னும் இல்லை</span>}
                        </div>
                        <div className="mt-4"><AssignJudgeForm slug={competition.slug} judges={options} /></div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
