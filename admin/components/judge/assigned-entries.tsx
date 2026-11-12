"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { JudgeAssignedEntry } from "@/lib/judging/api";
import { staff } from "@/lib/staff/messages";

// The judge's own assigned entries (the API sends only those, with the judge's own score). Search, the two dropdowns and the sort work on this
// full list at once, so there is no request per keystroke. Only the entry reference and competition are shown: no child or parent detail.

const M = staff.judge;
const PAGE_SIZE = 10;
const SORTS: Record<string, { label: string; compare: (a: JudgeAssignedEntry, b: JudgeAssignedEntry) => number }> = {
  assigned: { label: "Assigned order", compare: () => 0 }, // the API order (oldest assignment first); Array.sort is stable
  pending: { label: "Pending first", compare: (a, b) => rank(a) - rank(b) },
  score: { label: "Highest score", compare: (a, b) => (b.score?.marks ?? -1) - (a.score?.marks ?? -1) },
  code: { label: "Entry reference", compare: (a, b) => a.entryCode.localeCompare(b.entryCode) },
};
const rank = (e: JudgeAssignedEntry) => (e.score?.status === "final" ? 2 : e.score?.status === "draft" ? 1 : 0);
const statusOf = (e: JudgeAssignedEntry) => e.score?.status ?? "none";

function StatusBadge({ entry }: { entry: JudgeAssignedEntry }) {
  const s = statusOf(entry);
  const m = s === "final" ? M.statusFinal : s === "draft" ? M.statusDraft : M.statusNone;
  const tone = s === "final" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : s === "draft" ? "border-violet-200 bg-violet-50 text-violet-700" : "border-amber-200 bg-amber-50 text-amber-700";
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.6875rem] font-bold ${tone}`}>{m.en} <span lang="ta" className="ml-1 font-medium">/ {m.ta}</span></span>;
}

export function AssignedEntries({ entries }: { entries: JudgeAssignedEntry[] }) {
  const [search, setSearch] = useState("");
  const [competition, setCompetition] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("assigned");
  const [page, setPage] = useState(1);

  const competitions = useMemo(() => {
    const seen = new Map<string, JudgeAssignedEntry>();
    for (const e of entries) if (!seen.has(e.competitionSlug)) seen.set(e.competitionSlug, e);
    return [...seen.values()];
  }, [entries]);

  const shown = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return entries
      .filter((e) => (!query || e.entryCode.toLocaleLowerCase().includes(query)) && (!competition || e.competitionSlug === competition) && (!status || statusOf(e) === status))
      .sort(SORTS[sort]!.compare);
  }, [entries, search, competition, status, sort]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const active = Boolean(search.trim() || competition || status || sort !== "assigned");
  const change = (apply: () => void) => { apply(); setPage(1); };
  const clear = () => { setSearch(""); setCompetition(""); setStatus(""); setSort("assigned"); setPage(1); };
  const label = "block text-xs font-semibold leading-snug text-rio-navy";

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <div>
          <label htmlFor="judge-search" className={label}>Search <span lang="ta" className="font-medium text-rio-slate">/ தேடு</span></label>
          <input id="judge-search" type="search" value={search} onChange={(e) => change(() => setSearch(e.target.value))} maxLength={40} placeholder={M.searchEntries} autoComplete="off" className="field mt-1 h-11 min-h-11 text-sm" />
        </div>
        <div>
          <label htmlFor="judge-competition" className={label}>Competition <span lang="ta" className="font-medium text-rio-slate">/ போட்டி</span></label>
          <select id="judge-competition" value={competition} onChange={(e) => change(() => setCompetition(e.target.value))} className="field mt-1 h-11 min-h-11 text-sm">
            <option value="">{M.allCompetitions}</option>
            {competitions.map((c) => <option key={c.competitionSlug} value={c.competitionSlug}>{c.competitionNameEn} / {c.competitionNameTa}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="judge-status" className={label}>Scoring status <span lang="ta" className="font-medium text-rio-slate">/ நிலை</span></label>
          <select id="judge-status" value={status} onChange={(e) => change(() => setStatus(e.target.value))} className="field mt-1 h-11 min-h-11 text-sm">
            <option value="">{M.allStatuses}</option>
            <option value="none">{M.statusNone.en}</option>
            <option value="draft">{M.statusDraft.en}</option>
            <option value="final">{M.statusFinal.en}</option>
          </select>
        </div>
        <div>
          <label htmlFor="judge-sort" className={label}>Order by <span lang="ta" className="font-medium text-rio-slate">/ வரிசை</span></label>
          <select id="judge-sort" value={sort} onChange={(e) => change(() => setSort(e.target.value))} className="field mt-1 h-11 min-h-11 text-sm">
            {Object.entries(SORTS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
          </select>
        </div>
        {active && <button type="button" onClick={clear} className="btn btn-outline h-11 min-h-11 !px-4 text-sm">Clear <span lang="ta" className="font-medium">/ {M.clearFilters.ta}</span></button>}
      </div>
      <p className="mt-3 text-xs font-medium text-rio-slate" role="status">Showing {shown.length} of {entries.length} entries</p>

      {visible.length === 0 ? (
        <p role="status" className="mt-4 rounded-xl bg-rio-mist px-4 py-3 text-sm leading-snug text-rio-slate">
          {M.filtersNone.en} <span lang="ta" className="block font-medium">{M.filtersNone.ta}</span>
        </p>
      ) : (
        <div className="mt-4">
          <table className="w-full border-separate border-spacing-0 text-left text-[0.8125rem] text-rio-ink">
            <thead className="hidden bg-rio-blush text-xs uppercase tracking-wide text-rio-navy lg:table-header-group">
              <tr>
                <th scope="col" className="w-[20%] rounded-l-xl px-3 py-2.5 font-bold">Entry reference<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">பதிவு குறியீடு</span></th>
                <th scope="col" className="w-[26%] px-3 py-2.5 font-bold">Competition<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">போட்டி</span></th>
                <th scope="col" className="px-3 py-2.5 font-bold">Video<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">வீடியோ</span></th>
                <th scope="col" className="px-3 py-2.5 font-bold">Scoring status<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">மதிப்பீட்டு நிலை</span></th>
                <th scope="col" className="px-3 py-2.5 font-bold">Score<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">மதிப்பெண்</span></th>
                <th scope="col" className="rounded-r-xl px-3 py-2.5 text-right font-bold">Actions<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">செயல்கள்</span></th>
              </tr>
            </thead>
            <tbody className="block space-y-3 lg:table-row-group lg:space-y-0 lg:divide-y lg:divide-rio-navy/10">
              {visible.map((e) => {
                const s = statusOf(e);
                const action = s === "final" ? M.viewScore : s === "draft" ? M.continueAction : M.scoreAction;
                return (
                  <tr key={e.entryCode} className="block rounded-2xl border border-rio-navy/10 bg-white p-3 shadow-sm hover:border-rio-rose/20 hover:bg-rio-blush/30 lg:table-row lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
                    <td className="flex items-center justify-between gap-3 py-1.5 lg:table-cell lg:px-3 lg:py-2.5">
                      <span className="font-mono text-[0.8125rem] font-bold text-rio-navy">{e.entryCode}</span>
                      <span className="lg:hidden"><StatusBadge entry={e} /></span>
                    </td>
                    <td className="block py-1.5 lg:table-cell lg:px-3 lg:py-2.5">
                      <span className="block font-semibold leading-snug text-rio-navy">{e.competitionNameEn}</span>
                      <span lang="ta" className="block text-xs leading-snug text-rio-slate">{e.competitionNameTa}</span>
                    </td>
                    <td className="block py-1.5 lg:table-cell lg:px-3 lg:py-2.5">
                      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.6875rem] font-bold ${e.hasVideo ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-rio-slate"}`}>
                        <Icon name="video" className="h-3 w-3 shrink-0" />{(e.hasVideo ? M.videoReady : M.videoMissing).en} <span lang="ta" className="font-medium">/ {(e.hasVideo ? M.videoReady : M.videoMissing).ta}</span>
                      </span>
                    </td>
                    <td className="hidden lg:table-cell lg:px-3 lg:py-2.5"><StatusBadge entry={e} /></td>
                    <td className="block py-1.5 font-semibold tabular-nums text-rio-navy lg:table-cell lg:px-3 lg:py-2.5">
                      <span className="mr-2 text-[0.6875rem] font-bold uppercase tracking-wide text-rio-slate lg:hidden">Score</span>
                      {e.score?.marks != null && e.score.status ? <>{e.score.marks} / 10</> : <span className="font-normal text-rio-slate">–</span>}
                    </td>
                    <td className="block pt-2 lg:table-cell lg:px-3 lg:py-2.5 lg:text-right">
                      <Link href={`/judge/entries/${e.entryCode}`} className={`btn ${s === "final" ? "btn-outline" : "btn-primary"} min-h-9 w-full whitespace-nowrap !px-4 !py-1 text-xs lg:w-auto`} aria-label={`${action.en} ${e.entryCode}`}>
                        {action.en} <span lang="ta" className="font-medium">/ {action.ta}</span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pageCount > 1 && (
            <nav aria-label="Assigned entry pages" className="mt-4 flex items-center justify-center gap-2 border-t border-rio-navy/10 pt-4">
              <button type="button" aria-label="Previous page" disabled={safePage === 1} onClick={() => setPage((c) => Math.max(1, c - 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rio-rose/25 text-rio-navy disabled:opacity-40"><span aria-hidden="true">‹</span></button>
              <span className="px-2 text-sm font-semibold text-rio-navy">Page {safePage} of {pageCount}</span>
              <button type="button" aria-label="Next page" disabled={safePage === pageCount} onClick={() => setPage((c) => Math.min(pageCount, c + 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rio-rose/25 text-rio-navy disabled:opacity-40"><span aria-hidden="true">›</span></button>
            </nav>
          )}
        </div>
      )}
    </>
  );
}
