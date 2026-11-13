import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { loadResultsOverview } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";
import { PublishLine } from "@/components/admin/publish-line";

export const metadata: Metadata = { title: "முடிவுகள் · Results", robots: { index: false } };
export const dynamic = "force-dynamic";

// Winners per competition and when results go public, from GET /admin/results. Each competition opens the page to choose its winners.
export default async function AdminResultsPage() {
  await requireStaff("admin");
  const overview = await loadResultsOverview();

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <p lang="en" className="eyebrow">
        <span aria-hidden="true" className="h-px w-8 bg-current" />
        Results management
      </p>
      <h1 className="mt-2 text-[clamp(1.75rem,4vw,2rem)] font-bold leading-tight text-rio-navy">
        <span lang="ta" className="block">முடிவுகள்</span>
        <span lang="en" className="mt-0.5 block text-base font-medium leading-snug text-rio-slate sm:text-lg">Results</span>
      </h1>
      {!overview.ok ? (
        <p role="alert" className="mt-6 flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-3 font-semibold text-rio-error">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            The results could not be loaded. Reload to try again.
            <span lang="ta" className="mt-1 block font-medium">முடிவுகளை ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள்.</span>
          </span>
        </p>
      ) : (
        <>
          <PublishLine publishAt={overview.data.publishAt} frozen={overview.data.frozen} />
          <ul className="mt-6 grid gap-4 md:grid-cols-2">
            {overview.data.competitions.map((c) => (
              <li key={c.slug}>
                <Link href={`/admin/results/${c.slug}`} className="card flex h-full min-h-11 flex-col gap-2 p-4 hover:bg-rio-blush sm:p-5">
                  <span lang="ta" className="font-display text-xl font-bold text-rio-navy">{c.nameTa}</span>
                  <span className="font-semibold text-rio-slate">{c.nameEn}</span>
                  <span className="text-rio-navy">
                    <strong className="tabular-nums">{c.winners}</strong> winner{c.winners === 1 ? "" : "s"} chosen · {c.finalized} submitted entr{c.finalized === 1 ? "y" : "ies"}
                  </span>
                  <span className="mt-auto inline-flex items-center gap-1 font-semibold text-rio-rose">
                    Choose winners / வெற்றியாளர்கள் <Icon name="arrow" className="h-4 w-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
