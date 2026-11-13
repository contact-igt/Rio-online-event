import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { loadScoringOverview } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "மதிப்பெண் · Scoring", robots: { index: false } };
export const dynamic = "force-dynamic";

// How far judging has got in each competition, from GET /admin/scoring. Each competition opens its ranking. Read only.
export default async function AdminScoringPage() {
  await requireStaff("admin");
  const overview = await loadScoringOverview();

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <p lang="en" className="eyebrow">
        <span aria-hidden="true" className="h-px w-8 bg-current" />
        Scoring management
      </p>
      <h1 className="mt-2 text-[clamp(1.75rem,4vw,2rem)] font-bold leading-tight text-rio-navy">
        <span lang="ta" className="block">மதிப்பீடுகள்</span>
        <span lang="en" className="mt-0.5 block text-base font-medium leading-snug text-rio-slate sm:text-lg">Scoring</span>
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-rio-slate">
        Submitted entries, how many every assigned judge has finished, and ties to decide. Open a competition to see its ranking.
        <span lang="ta" className="block">சமர்ப்பிக்கப்பட்ட பதிவுகள், நடுவர்கள் முடித்தவை, சமநிலைகள். தரவரிசையைப் பார்க்க ஒரு போட்டியைத் திறக்கவும்.</span>
      </p>

      {!overview.ok ? (
        <p role="alert" className="mt-6 flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-3 font-semibold text-rio-error">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            The scores could not be loaded. Reload to try again.
            <span lang="ta" className="mt-1 block font-medium">மதிப்பெண்களை ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள்.</span>
          </span>
        </p>
      ) : overview.data.competitions.length === 0 ? (
        <p className="card mt-6 p-4 text-rio-slate">No competitions yet. <span lang="ta" className="block">இன்னும் போட்டிகள் இல்லை.</span></p>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {overview.data.competitions.map((c) => (
            <li key={c.slug}>
              <Link href={`/admin/scoring/${c.slug}`} className="card flex h-full min-h-11 flex-col gap-3 p-4 hover:bg-rio-blush sm:p-5">
                <span>
                  <span lang="ta" className="block font-display text-xl font-bold text-rio-navy">{c.nameTa}</span>
                  <span className="block font-semibold text-rio-slate">{c.nameEn}</span>
                </span>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-rio-mist p-2">
                    <dt className="text-xs font-semibold text-rio-slate">Submitted</dt>
                    <dd className="font-display text-xl font-bold text-rio-navy tabular-nums">{c.submitted}</dd>
                  </div>
                  <div className="rounded-xl bg-rio-mist p-2">
                    <dt className="text-xs font-semibold text-rio-slate">Ranked</dt>
                    <dd className="font-display text-xl font-bold text-rio-navy tabular-nums">{c.ranked}</dd>
                  </div>
                  <div className="rounded-xl bg-rio-mist p-2">
                    <dt className="text-xs font-semibold text-rio-slate">Ties</dt>
                    <dd className="font-display text-xl font-bold text-rio-navy tabular-nums">{c.ties}</dd>
                  </div>
                </dl>
                <span className="text-sm text-rio-slate">
                  {c.waiting} waiting for judges · {c.notAssigned} not assigned{c.heldForReview > 0 ? ` · ${c.heldForReview} held for review` : ""}
                </span>
                <span className="mt-auto inline-flex items-center gap-1 font-semibold text-rio-rose">
                  View ranking / தரவரிசை <Icon name="arrow" className="h-4 w-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
