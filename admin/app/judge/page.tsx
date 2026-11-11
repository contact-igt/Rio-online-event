import type { Metadata } from "next";
import { EntryList, type JudgeRow } from "@/components/judge/entry-list";
import { Icon } from "@/components/ui/icon";
import { events } from "@/lib/events";
import { loadJudgeEntries } from "@/lib/judging/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "நடுவர் பக்கம் · Judge · Rio", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function JudgePage() {
  await requireStaff("judge");
  const entriesRes = await loadJudgeEntries();

  const entries = entriesRes.ok ? entriesRes.data : [];
  const total = entries.length;
  const completed = entries.filter((e) => e.score?.status === "final").length;
  const drafts = entries.filter((e) => e.score?.status === "draft").length;
  const pending = total - completed;

  const rows: JudgeRow[] = entries.map((e) => {
    const event = events.find((ev) => ev.slug === e.competitionSlug);
    return {
      entry_id: e.entryCode,
      entry_code: e.entryCode,
      event_id: event?.number ?? 1,
      score_status: e.score?.status ?? null,
      my_marks: e.score?.marks ?? null,
    };
  });

  return (
    <section className="mx-auto w-full max-w-[900px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[clamp(1.75rem,5vw,2.5rem)] font-extrabold text-rio-navy">
          Judge Portal
          <span lang="ta" className="block text-[0.6em] font-bold text-rio-slate">
            நடுவர் பக்கம்
          </span>
        </h1>
        <p className="text-rio-slate">
          Review the assigned entries, watch the video, and submit your score (0 to 10).
          <span lang="ta" className="mt-1 block font-medium">
            ஒதுக்கப்பட்ட பதிவுகளைப் பார்த்து, வீடியோவை ஆய்வு செய்து மதிப்பெண் (0-10) வழங்குங்கள்.
          </span>
        </p>
      </div>

      {/* Progress Cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <span className="text-xs uppercase tracking-wider text-rio-slate font-bold">Assigned</span>
          <span className="mt-1 block font-display text-2xl font-bold text-rio-navy">{total}</span>
        </div>
        <div className="card p-4">
          <span className="text-xs uppercase tracking-wider text-emerald-700 font-bold">Scored (Final)</span>
          <span className="mt-1 block font-display text-2xl font-bold text-emerald-800">{completed}</span>
        </div>
        <div className="card col-span-2 p-4 sm:col-span-1">
          <span className="text-xs uppercase tracking-wider text-amber-700 font-bold">Pending</span>
          <span className="mt-1 block font-display text-2xl font-bold text-amber-800">
            {pending} {drafts > 0 && <span className="text-sm font-sans font-medium text-rio-slate">({drafts} draft)</span>}
          </span>
        </div>
      </div>

      {/* Entry List */}
      <div className="card mt-6 p-6">
        <h2 className="text-lg font-bold text-rio-navy mb-4">
          Assigned Entries <span lang="ta" className="text-sm font-semibold text-rio-slate">/ ஒதுக்கப்பட்ட பதிவுகள்</span>
        </h2>

        {!entriesRes.ok && (
          <p role="alert" className="flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-4 font-semibold text-rio-error">
            <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              Could not load assigned entries from the server.
              <span lang="ta" className="mt-1 block font-medium">ஒதுக்கப்பட்ட பதிவுகளை ஏற்ற முடியவில்லை.</span>
            </span>
          </p>
        )}

        {entriesRes.ok && total === 0 && (
          <div className="rounded-2xl border border-dashed border-rio-navy/20 p-8 text-center">
            <Icon name="video" className="mx-auto h-10 w-10 text-rio-slate/50" />
            <p className="mt-2 font-semibold text-rio-navy">No entries assigned yet.</p>
            <p className="text-sm text-rio-slate">
              Entries will appear here once the administrator assigns them to you.
              <span lang="ta" className="mt-1 block font-medium">நிர்வாகி பதிவுகளை ஒதுக்கியதும் இங்கு தோன்றும்.</span>
            </p>
          </div>
        )}

        {entriesRes.ok && total > 0 && <EntryList rows={rows} />}
      </div>
    </section>
  );
}
