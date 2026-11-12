import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublishLine } from "@/components/admin/publish-line";
import { Icon } from "@/components/ui/icon";
import { loadWinners } from "@/lib/admin/api";
import { awards } from "@/lib/events";
import { requireStaff } from "@/lib/staff/auth";
import { approveWinnerAction, removeWinnerAction } from "../actions";

export const metadata: Metadata = { title: "வெற்றியாளர்கள் · Winners", robots: { index: false } };
export const dynamic = "force-dynamic";

// Choose a competition's winners by hand, informed by the ranking (GET /admin/competitions/:slug/winners). The public page shows only the
// place, the display name typed here and the award, and only after the Event Settings publication time; from then on nothing can change.

const NOTICE: Record<string, { en: string; ta: string }> = {
  approved: { en: "Winner saved. Not public until the publication time.", ta: "வெற்றியாளர் சேமிக்கப்பட்டார். வெளியீட்டு நேரம் வரை பொதுவில் தெரியாது." },
  removed: { en: "Winner removed.", ta: "வெற்றியாளர் நீக்கப்பட்டார்." },
};
const ERROR: Record<string, { en: string; ta: string }> = {
  place_taken: { en: "That place already has a winner. Remove it first.", ta: "அந்த இடத்துக்கு ஏற்கெனவே வெற்றியாளர் உள்ளார்." },
  already_winner: { en: "This entry is already a winner.", ta: "இந்தப் பதிவு ஏற்கெனவே வெற்றியாளர்." },
  entry_not_finalized: { en: "Only a submitted entry can win.", ta: "சமர்ப்பிக்கப்பட்ட பதிவு மட்டுமே வெற்றி பெற முடியும்." },
  entry_not_found: { en: "That entry is not in this competition.", ta: "அந்தப் பதிவு இந்தப் போட்டியில் இல்லை." },
  results_frozen: { en: "Results are public. Winners can no longer change.", ta: "முடிவுகள் வெளியிடப்பட்டன; மாற்ற முடியாது." },
  confirm_required: { en: "Tick the box to confirm the winner.", ta: "உறுதிப்படுத்தப் பெட்டியைத் தேர்வு செய்யுங்கள்." },
  invalid: { en: "Check the place (1 to 10) and the public name (up to 60 characters).", ta: "இடம் (1-10), பெயர் (60 எழுத்துகள் வரை) சரிபார்க்கவும்." },
  not_found: { en: "That winner was not found. Reload the page.", ta: "அந்த வெற்றியாளரைக் காணவில்லை." },
  forbidden: { en: "Your session cannot do this. Sign in again.", ta: "மீண்டும் உள்நுழையுங்கள்." },
  unavailable: { en: "The server is not reachable. Nothing was changed.", ta: "சேவையகத்தை அணுக முடியவில்லை. எதுவும் மாற்றப்படவில்லை." },
  other: { en: "That could not be done. Nothing was changed.", ta: "அதைச் செய்ய முடியவில்லை." },
};
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const mark = (m: number | null) => (m === null ? "–" : m.toFixed(2));

function Banner({ kind, text }: { kind: "ok" | "error"; text: { en: string; ta: string } }) {
  return (
    <p role={kind === "error" ? "alert" : "status"} className={`mt-4 flex items-start gap-3 rounded-2xl border bg-white p-3 font-semibold ${kind === "error" ? "border-rio-error/40 text-rio-error" : "border-rio-ok/40 text-rio-ok"}`}>
      <Icon name={kind === "error" ? "info" : "check"} className="mt-0.5 h-5 w-5 shrink-0" />
      <span>{text.en}<span lang="ta" className="mt-1 block font-medium">{text.ta}</span></span>
    </p>
  );
}

export default async function AdminWinnersPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaff("admin");
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) notFound();
  const sp = await searchParams;
  const notice = NOTICE[one(sp.notice) ?? ""];
  const error = one(sp.error) ? (ERROR[one(sp.error)!] ?? ERROR.other!) : undefined;
  const loaded = await loadWinners(slug);
  if (!loaded.ok && loaded.reason === "not_found") notFound();

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="text-sm text-rio-slate">
        <Link href="/admin/results" className="inline-flex min-h-11 items-center underline underline-offset-2">Results</Link> / Winners
      </nav>
      {!loaded.ok ? (
        <Banner kind="error" text={ERROR.unavailable!} />
      ) : (
        <>
          <h1 className="mt-2 text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold">
            <span lang="ta">{loaded.data.competition.nameTa}</span>
            <span className="block text-[0.6em] font-bold text-rio-slate">{loaded.data.competition.nameEn} · Winners</span>
          </h1>
          {notice && <Banner kind="ok" text={notice} />}
          {error && <Banner kind="error" text={error} />}
          <PublishLine publishAt={loaded.data.publishAt} frozen={loaded.data.frozen} />

          <div className="card mt-6 p-4 sm:p-6">
            <h2 className="font-display text-2xl font-bold text-rio-navy">Winners <span lang="ta" className="font-medium">/ வெற்றியாளர்கள்</span></h2>
            {loaded.data.winners.length === 0 ? (
              <p className="mt-2 text-rio-slate">No winner chosen yet. Use the form below. <span lang="ta" className="block">இன்னும் வெற்றியாளர் தேர்வு செய்யப்படவில்லை.</span></p>
            ) : (
              <ol className="mt-2 divide-y divide-rio-navy/10">
                {loaded.data.winners.map((w) => (
                  <li key={w.place} className="grid gap-x-4 gap-y-2 py-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-center">
                    <span className="font-display text-2xl font-bold text-rio-navy tabular-nums">#{w.place}</span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="block font-semibold text-rio-navy">Public name: {w.displayName}</span>
                      {w.awardLabel && <span lang="ta" className="block text-rio-navy">{w.awardLabel}</span>}
                      <span className="block text-sm text-rio-slate">
                        <Link href={`/admin/registrations/${w.entryCode}`} className="inline-flex min-h-11 items-center font-mono underline underline-offset-2">{w.entryCode}</Link> · {w.childName} · average {mark(w.average)}{w.rank !== null ? ` · ranked #${w.rank}` : ""}
                      </span>
                    </span>
                    {!loaded.data.frozen && (
                      <details className="min-w-0">
                        <summary className="btn btn-outline min-h-11 cursor-pointer list-none">Remove…</summary>
                        <form action={removeWinnerAction} className="mt-2 rounded-xl bg-rio-blush p-3">
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="place" value={w.place} />
                          <p className="text-sm font-semibold text-rio-navy">Remove this winner? / இந்த வெற்றியாளரை நீக்கவா?</p>
                          <button type="submit" className="btn btn-primary mt-2 min-h-11">Yes, remove</button>
                        </form>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {!loaded.data.frozen && (
            <form action={approveWinnerAction} className="card mt-6 grid gap-4 p-4 sm:p-6">
              <input type="hidden" name="slug" value={slug} />
              <h2 className="font-display text-2xl font-bold text-rio-navy">Add a winner <span lang="ta" className="font-medium">/ வெற்றியாளரைச் சேர்</span></h2>
              <p className="text-sm text-rio-slate">The list is in ranking order. Ties are marked: decide them yourself. Only submitted entries can win.</p>
              <div>
                <label htmlFor="entryCode" className="block font-semibold text-rio-navy">Entry <span lang="ta" className="font-medium">/ பதிவு</span></label>
                <select id="entryCode" name="entryCode" required className="field mt-1">
                  {loaded.data.candidates.filter((c) => !loaded.data.winners.some((w) => w.entryCode === c.entryCode)).map((c) => (
                    <option key={c.entryCode} value={c.entryCode}>
                      {c.rank !== null ? `#${c.rank}` : "unranked"} · {c.entryCode} · {c.childName} · {mark(c.average)}{c.tie ? " · tie" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="place" className="block font-semibold text-rio-navy">Place <span lang="ta" className="font-medium">/ இடம்</span></label>
                  <select id="place" name="place" required className="field mt-1">
                    {Array.from({ length: 10 }, (_, i) => i + 1).filter((p) => !loaded.data.winners.some((w) => w.place === p)).map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="displayName" className="block font-semibold text-rio-navy">Public name <span lang="ta" className="font-medium">/ பொதுப் பெயர்</span></label>
                  <input id="displayName" name="displayName" required maxLength={60} autoComplete="off" className="field mt-1" aria-describedby="displayName-help" />
                  <p id="displayName-help" className="mt-1 text-sm text-rio-slate">Shown on the public results page. Use the child&apos;s first name only.</p>
                </div>
              </div>
              <div>
                <label htmlFor="awardLabel" className="block font-semibold text-rio-navy">Award (optional) <span lang="ta" className="font-medium">/ விருது</span></label>
                <input id="awardLabel" name="awardLabel" list="award-list" maxLength={80} autoComplete="off" className="field mt-1" />
                <datalist id="award-list">{awards.map((a) => <option key={a} value={a} />)}</datalist>
              </div>
              <label className="flex min-h-11 items-center gap-3 font-semibold text-rio-navy">
                <input type="checkbox" name="confirm" value="yes" required className="h-6 w-6 accent-rio-rose" />
                I confirm this winner. / இந்த வெற்றியாளரை உறுதிசெய்கிறேன்.
              </label>
              <button type="submit" className="btn btn-primary w-full sm:w-auto">Save winner / சேமி</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
