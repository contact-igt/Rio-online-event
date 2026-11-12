import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlaybackPanel } from "@/components/judge/playback-panel";
import { ScoreForm } from "@/components/judge/score-form";
import { Icon } from "@/components/ui/icon";
import { loadJudgeEntryDetail } from "@/lib/judging/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "பதிவு ஆய்வு · Review Entry · Judge", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function JudgeEntryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff("judge");
  const { id } = await params;
  const entryRes = await loadJudgeEntryDetail(id);

  if (!entryRes.ok) {
    if (entryRes.reason === "not_found") notFound();
    return (
      <section className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-6">
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-4 font-semibold text-rio-error">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            The entry could not be loaded from the server.
            <span lang="ta" className="mt-1 block font-medium">பதிவை ஏற்ற முடியவில்லை.</span>
          </span>
        </p>
        <Link href="/judge" className="btn btn-outline mt-4 inline-block">
          ← Back to assigned entries
        </Link>
      </section>
    );
  }

  const { entry } = { entry: entryRes.data };

  return (
    <section className="mx-auto w-full max-w-[900px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6">
      <div className="mb-6">
        <Link href="/judge" className="inline-flex items-center gap-1.5 text-sm font-semibold text-rio-blue hover:underline">
          <Icon name="chevron" className="h-4 w-4 rotate-180" />
          <span>Back to entries / பதிவுகள் பட்டியல்</span>
        </Link>
      </div>

      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <span className="font-mono text-sm font-bold tracking-wider text-rio-rose">ENTRY CODE</span>
          <h1 className="text-3xl font-extrabold text-rio-navy">{entry.entryCode}</h1>
          <p className="mt-1 font-semibold text-rio-slate">
            {entry.competition.nameTa} <span lang="en">/ {entry.competition.nameEn}</span>
          </p>
        </div>
      </div>

      {/* Video Playback Panel */}
      <div className="card mt-6 p-6">
        <h2 className="text-xl font-bold text-rio-navy mb-4">
          Video Submission <span lang="ta" className="text-base font-semibold text-rio-slate">/ சமர்ப்பிக்கப்பட்ட வீடியோ</span>
        </h2>
        <PlaybackPanel entryId={entry.entryCode} available={entry.hasVideo} />
      </div>

      {/* Score Form (0 to 10) */}
      <div className="card mt-6 p-6">
        <h2 className="text-xl font-bold text-rio-navy mb-1">
          Evaluate & Score <span lang="ta" className="text-base font-semibold text-rio-slate">/ மதிப்பீடு செய்து மதிப்பெண் வழங்குக</span>
        </h2>
        <p className="text-sm text-rio-slate mb-6">
          Score this entry from 0 to 10. You can save as a draft first and submit as final when satisfied.
          <span lang="ta" className="mt-0.5 block font-medium">
            0 முதல் 10 வரை மதிப்பெண் வழங்கி சேமிக்கவும். பின்னர் இறுதியாகச் சமர்ப்பிக்கலாம்.
          </span>
        </p>
        <ScoreForm
          entryId={entry.entryCode}
          marks={entry.score?.marks ?? null}
          comments={entry.score?.comments ?? null}
          status={entry.score?.status ?? null}
        />
      </div>
    </section>
  );
}
