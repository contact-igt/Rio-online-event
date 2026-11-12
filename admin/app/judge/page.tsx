import type { Metadata } from "next";
import { AssignedEntries } from "@/components/judge/assigned-entries";
import { RetryButton } from "@/components/judge/retry-button";
import { Icon } from "@/components/ui/icon";
import { loadJudgeEntries } from "@/lib/judging/api";
import { requireStaff } from "@/lib/staff/auth";
import { staff } from "@/lib/staff/messages";

export const metadata: Metadata = { title: "நடுவர் பக்கம் · Judge · Rio", robots: { index: false } };
export const dynamic = "force-dynamic";

const M = staff.judge;

function Stat({ label, value, note, tone }: { label: { ta: string; en: string }; value: number | null; note?: string; tone: string }) {
  return (
    <div className="card flex items-center justify-between gap-3 px-4 py-3">
      <p className="min-w-0 leading-tight">
        <span className={`block text-xs font-bold uppercase tracking-wide ${tone}`}>{label.en}</span>
        <span lang="ta" className="block text-xs font-medium text-rio-slate">{label.ta}</span>
        {note && <span className="mt-0.5 block text-xs text-rio-slate">{note}</span>}
      </p>
      <span className="font-display text-3xl font-bold leading-none text-rio-navy tabular-nums">{value ?? "–"}</span>
    </div>
  );
}

export default async function JudgePage() {
  // The session check and the assignment list are independent round trips: they run together, and nothing renders unless the check passes.
  const [, entriesRes] = await Promise.all([requireStaff("judge"), loadJudgeEntries()]);

  // Counts come only from real rows. Assigned = Scored (final) + Pending (everything not final, drafts included), so the three always add up.
  // When the list could not be loaded the figures are a dash, not a zero.
  const entries = entriesRes.ok ? entriesRes.data : [];
  const total = entries.length;
  const scored = entries.filter((e) => e.score?.status === "final").length;
  const drafts = entries.filter((e) => e.score?.status === "draft").length;
  const known = entriesRes.ok;

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <p lang="en" className="eyebrow">
        <span aria-hidden="true" className="h-px w-8 bg-current" />
        {M.workspace}
      </p>
      <h1 className="mt-2 text-[clamp(1.75rem,4vw,2rem)] font-bold leading-tight text-rio-navy">
        <span lang="ta" className="block">{M.portal.ta}</span>
        <span lang="en" className="mt-0.5 block text-base font-medium leading-snug text-rio-slate sm:text-lg">{M.portal.en}</span>
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-rio-slate">
        {M.workspaceIntro.en}
        <span lang="ta" className="block font-medium">{M.workspaceIntro.ta}</span>
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label={M.statAssigned} value={known ? total : null} tone="text-rio-navy" />
        <Stat label={M.statScored} value={known ? scored : null} tone="text-emerald-700" />
        <Stat label={M.statPending} value={known ? total - scored : null} note={known && drafts > 0 ? `${drafts} draft${drafts === 1 ? "" : "s"} saved` : undefined} tone="text-amber-700" />
      </div>

      <div className="card mt-5 p-4 sm:p-5">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold leading-snug text-rio-navy">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rio-blush text-rio-rose"><Icon name="list" className="h-5 w-5" /></span>
          <span><span lang="ta" className="block">ஒதுக்கப்பட்ட பதிவுகள்</span><span lang="en" className="block text-sm font-medium text-rio-slate">Assigned entries</span></span>
        </h2>

        {!entriesRes.ok && (
          <div role="alert" className="mt-4 rounded-2xl border border-rio-error/40 bg-white p-4 text-sm font-semibold leading-snug text-rio-error">
            <p className="flex items-start gap-3">
              <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{M.loadFailed.en}<span lang="ta" className="mt-1 block font-medium leading-[1.5]">{M.loadFailed.ta}</span></span>
            </p>
            <RetryButton />
          </div>
        )}

        {entriesRes.ok && total === 0 && (
          <div className="mt-4 rounded-2xl border border-dashed border-rio-navy/20 px-4 py-8 text-center">
            <Icon name="video" className="mx-auto h-9 w-9 text-rio-slate/50" />
            <p className="mt-2 font-semibold text-rio-navy">{M.noneTitle.en}<span lang="ta" className="block text-sm font-medium text-rio-slate">{M.noneTitle.ta}</span></p>
            <p className="mx-auto mt-1 max-w-md text-sm text-rio-slate">{M.noneNote.en}<span lang="ta" className="block font-medium">{M.noneNote.ta}</span></p>
          </div>
        )}

        {entriesRes.ok && total > 0 && <div className="mt-4"><AssignedEntries entries={entries} /></div>}
      </div>
    </section>
  );
}
