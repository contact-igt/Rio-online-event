import type { Metadata } from "next";
import { AssignJudgeForm } from "@/components/admin/assign-judge-form";
import { Icon } from "@/components/ui/icon";
import { loadCompetitions, loadJudgesList } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "Assign Judges · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AssignJudgesPage() {
  await requireStaff("admin");
  const [competitions, judges] = await Promise.all([loadCompetitions(), loadJudgesList()]);
  const activeJudges = judges.ok ? judges.data.filter((judge) => judge.active).map((judge) => ({ id: String(judge.id), name: `${judge.name} (${judge.judgeCode})` })) : [];

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
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-rio-slate">Choose an active judge for each competition. Assignments apply only to submitted entries and are safe to repeat.</p>

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
                  <p className="mt-1 text-sm text-rio-slate">Select an active judge inside each competition row.</p>
                </div>
              </div>

              {competitions.data.length === 0 ? (
                <p className="mt-4 rounded-xl bg-rio-mist px-4 py-3 text-sm leading-snug text-rio-slate">No competitions are available yet. Add a competition before assigning judges.</p>
              ) : activeJudges.length === 0 ? (
                <p className="mt-4 rounded-xl bg-rio-mist px-4 py-3 text-sm leading-snug text-rio-slate">No active judges exist yet. Add judges before assigning them to a competition.</p>
              ) : (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {competitions.data.map((competition) => (
                    <article key={competition.slug} className="rounded-2xl border border-rio-navy/10 bg-white p-4 shadow-sm">
                      <h3 className="font-display text-xl font-bold leading-snug text-rio-navy">{competition.nameTa}<span lang="en" className="mt-0.5 block text-sm font-semibold text-rio-slate">{competition.nameEn}</span></h3>
                      <div className="mt-4"><AssignJudgeForm slug={competition.slug} judges={activeJudges} /></div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
