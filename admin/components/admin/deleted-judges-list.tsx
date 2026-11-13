"use client";

import { useState } from "react";
import { PurgeJudgeDialog, RestoreJudgeDialog } from "@/components/admin/judge-dialogs";
import { Icon } from "@/components/ui/icon";
import type { DeletedJudgeRow } from "@/lib/admin/api";
import { formatIst } from "@/lib/admin/format";
import { staff } from "@/lib/staff/messages";

// The Deleted judges table: the same card, header and row style as the Deleted registrations table. Search and paging work on the full list,
// which the API sends whole (there are few judges). After a restore or a permanent delete the row simply leaves this list.

const M = staff.judges;
const PAGE_SIZE = 6;
type Dialog = { kind: "restore" | "purge"; judge: DeletedJudgeRow } | null;

export function DeletedJudgesList({ judges: initial }: { judges: DeletedJudgeRow[] }) {
  const [judges, setJudges] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setJudges(initial);
  }
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);

  const query = search.trim().toLocaleLowerCase();
  const matching = judges.filter((j) => !query || [j.name, j.email, j.judgeCode].some((v) => v.toLocaleLowerCase().includes(query)));
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = matching.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const remove = (id: number) => { setJudges((rows) => rows.filter((row) => row.id !== id)); setDialog(null); };

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold leading-snug text-rio-navy">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rio-blush text-rio-rose"><Icon name="trash" className="h-5 w-5" /></span>
          <span><span lang="ta" className="block">{M.deletedTitle.ta}</span><span lang="en" className="block text-sm font-medium text-rio-slate">{M.deletedTitle.en}</span></span>
        </h2>
        <label className="relative block min-w-0 sm:w-64">
          <span className="sr-only">Search deleted judges</span>
          <Icon name="list" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rio-slate" />
          <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search deleted judges..." aria-label="Search deleted judges" className="field h-11 min-h-11 rounded-full pl-9 pr-3 text-sm" />
        </label>
      </div>
      <p className="mt-3 text-xs font-medium text-rio-slate" role="status">Showing {matching.length} of {judges.length} deleted judges</p>

      {visible.length === 0 ? (
        <p role="status" className="mt-4 rounded-xl bg-rio-mist px-4 py-3 text-sm leading-snug text-rio-slate">{judges.length === 0 ? M.deletedEmpty : "No deleted judges match the search."}</p>
      ) : (
        <div className="mt-4 -mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-[0.8125rem] text-rio-ink">
            <thead className="bg-rio-blush text-xs uppercase tracking-wide text-rio-navy">
              <tr>
                <th scope="col" className="w-[26%] rounded-l-xl px-3 py-2.5 font-bold">Judge / Code<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">நடுவர் / குறியீடு</span></th>
                <th scope="col" className="w-[28%] px-3 py-2.5 font-bold">Email<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">மின்னஞ்சல்</span></th>
                <th scope="col" className="px-3 py-2.5 font-bold">{M.deletedOn}<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">நீக்கிய நேரம்</span></th>
                <th scope="col" className="rounded-r-xl px-3 py-2.5 text-right font-bold">Actions<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">செயல்கள்</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rio-navy/10">
              {visible.map((judge) => (
                <tr key={judge.id} className="hover:bg-rio-blush/35">
                  <td className="px-3 py-2.5 align-middle">
                    <span className="block font-semibold leading-snug text-rio-navy [overflow-wrap:anywhere]">{judge.name}</span>
                    <span className="mt-0.5 block font-mono text-xs text-rio-slate">{judge.judgeCode}</span>
                  </td>
                  <td className="px-3 py-2.5 align-middle font-mono text-xs text-rio-slate [overflow-wrap:anywhere]">{judge.email}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-middle text-xs text-rio-slate">{formatIst(judge.deletedAt)}</td>
                  <td className="px-3 py-2.5 text-right align-middle">
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                      <button type="button" onClick={() => setDialog({ kind: "restore", judge })} className="btn btn-outline min-h-9 !px-3 text-xs">{M.restore.en}</button>
                      <button type="button" onClick={() => setDialog({ kind: "purge", judge })} className="btn btn-outline min-h-9 !px-3 text-xs !border-rio-error/40 !text-rio-error">{M.purge.en}</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <nav aria-label="Deleted judge pages" className="mt-4 flex items-center justify-center gap-2 border-t border-rio-navy/10 pt-4">
          <button type="button" aria-label="Previous page" disabled={safePage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rio-rose/25 text-rio-navy disabled:opacity-40"><span aria-hidden="true">‹</span></button>
          <span className="px-2 text-sm font-semibold text-rio-navy">Page {safePage} of {pageCount}</span>
          <button type="button" aria-label="Next page" disabled={safePage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rio-rose/25 text-rio-navy disabled:opacity-40"><span aria-hidden="true">›</span></button>
        </nav>
      )}

      {dialog?.kind === "restore" && <RestoreJudgeDialog judge={dialog.judge} onClose={() => setDialog(null)} onDone={() => remove(dialog.judge.id)} />}
      {dialog?.kind === "purge" && <PurgeJudgeDialog judge={dialog.judge} onClose={() => setDialog(null)} onDone={() => remove(dialog.judge.id)} />}
    </>
  );
}
