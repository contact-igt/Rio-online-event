import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlaybackPanel } from "@/components/judge/playback-panel";
import { RetryButton } from "@/components/judge/retry-button";
import { ScoreForm } from "@/components/judge/score-form";
import { Icon } from "@/components/ui/icon";
import { loadJudgeEntryDetail } from "@/lib/judging/api";
import { requireStaff } from "@/lib/staff/auth";
import { staff } from "@/lib/staff/messages";

export const metadata: Metadata = { title: "பதிவு ஆய்வு · Review Entry · Judge", robots: { index: false } };
export const dynamic = "force-dynamic";

const M = staff.judge;
// Same condition as the media-src rule in next.config.ts: a signed link is on the R2 host, which the page may load video from only when playback is on.
const playbackReady = process.env.RIO_PLAYBACK_ENABLED === "yes" && /^[0-9a-f]{32}$/i.test(process.env.R2_ACCOUNT_ID ?? "");

export default async function JudgeEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The session check and the entry are independent round trips: they run together, and nothing renders unless the check passes.
  const [, entryRes] = await Promise.all([requireStaff("judge"), loadJudgeEntryDetail(id)]);

  if (!entryRes.ok) {
    if (entryRes.reason === "not_found") notFound();
    return (
      <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div role="alert" className="rounded-2xl border border-rio-error/40 bg-white p-4 text-sm font-semibold text-rio-error">
          <p className="flex items-start gap-3">
            <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              The entry could not be loaded from the server.
              <span lang="ta" className="mt-1 block font-medium">பதிவை ஏற்ற முடியவில்லை.</span>
            </span>
          </p>
          <RetryButton />
        </div>
        <Link href="/judge" className="btn btn-outline mt-4 inline-flex min-h-10 !px-4 !py-1 text-sm">
          ← Back to assigned entries
        </Link>
      </section>
    );
  }

  const entry = entryRes.data;
  const s = entry.score?.status ?? null;
  const statusText = s === "final" ? M.statusFinal : s === "draft" ? M.statusDraft : M.statusNone;
  const tone = s === "final" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : s === "draft" ? "border-violet-200 bg-violet-50 text-violet-700" : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Link href="/judge" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-rio-blue hover:underline">
        <Icon name="chevron" className="h-4 w-4 rotate-180" />
        <span>Back to entries / {M.assigned.ta}</span>
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p lang="en" className="eyebrow">
            <span aria-hidden="true" className="h-px w-8 bg-current" />
            {M.review.en}
          </p>
          <h1 className="mt-2 font-mono text-[clamp(1.5rem,4vw,2rem)] font-bold leading-tight text-rio-navy">{entry.entryCode}</h1>
          <p className="mt-0.5 text-sm font-semibold text-rio-slate">
            {entry.competition.nameEn} <span lang="ta" className="font-medium">/ {entry.competition.nameTa}</span>
          </p>
        </div>
        <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold ${tone}`}>
          {statusText.en} <span lang="ta" className="ml-1 font-medium">/ {statusText.ta}</span>
        </span>
      </div>

      {/* Video on the left and the scoring card on the right; on a phone they stack. The API deliberately withholds entry answers. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <div className="card min-w-0 p-4 sm:p-5 lg:col-start-1">
          <h2 className="mb-3 text-lg font-semibold leading-snug text-rio-navy">
            <span lang="ta" className="block">{M.video.ta}</span>
            <span lang="en" className="block text-sm font-medium text-rio-slate">Video submission</span>
          </h2>
          <PlaybackPanel entryId={entry.entryCode} available={entry.hasVideo && playbackReady} reason={entry.hasVideo ? "off" : "noVideo"} />
        </div>

        <div className="card min-w-0 p-4 sm:p-5 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <h2 className="text-lg font-semibold leading-snug text-rio-navy">
            <span lang="ta" className="block">{M.yourScore.ta}</span>
            <span lang="en" className="block text-sm font-medium text-rio-slate">Evaluate and score</span>
          </h2>
          <div className="mt-4">
            <ScoreForm entryId={entry.entryCode} marks={entry.score?.marks ?? null} comments={entry.score?.comments ?? null} status={entry.score?.status ?? null} />
          </div>
        </div>

      </div>
    </section>
  );
}
