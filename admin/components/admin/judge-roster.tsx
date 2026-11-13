"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AdminJudgeRow } from "@/lib/admin/api";
import { Icon } from "@/components/ui/icon";
import { staff } from "@/lib/staff/messages";
import { DeactivateJudgeDialog, DeleteJudgeDialog, EditJudgeDialog, ResetJudgeDialog, ViewJudgeDialog } from "./judge-dialogs";

const PAGE_SIZE = 6;
const M = staff.judges;

type DialogKind = "view" | "edit" | "status" | "reset" | "delete";
type DialogState = { kind: DialogKind; judge: AdminJudgeRow } | null;
type OnPick = (kind: DialogKind, judge: AdminJudgeRow) => void;

type FilterState = {
  status: string[];
  password: string[];
  progress: string[];
  drafts: string[];
};

const EMPTY_FILTERS: FilterState = { status: [], password: [], progress: [], drafts: [] };

// Fixed list of sorts; every one ends on the id so the order never shuffles between renders.
const SORTS: Record<string, { label: string; compare: (a: AdminJudgeRow, b: AdminJudgeRow) => number }> = {
  newest: { label: "Newest added", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id },
  name_asc: { label: "Name A–Z", compare: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id - b.id },
  name_desc: { label: "Name Z–A", compare: (a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: "base" }) || a.id - b.id },
  scored: { label: "Most scored", compare: (a, b) => b.final - a.final || a.id - b.id },
  drafts: { label: "Most drafts", compare: (a, b) => b.drafts - a.drafts || a.id - b.id },
};

function copyFilters(filters: FilterState): FilterState {
  return Object.fromEntries(Object.entries(filters).map(([key, values]) => [key, [...values]])) as FilterState;
}

function selectedMatches(selected: string[], value: string) {
  return selected.length === 0 || selected.includes(value);
}

function FilterGroup({
  title,
  category,
  options,
  filters,
  onToggle,
}: {
  title: string;
  category: keyof FilterState;
  options: Array<{ value: string; label: string }>;
  filters: FilterState;
  onToggle: (category: keyof FilterState, value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-[0.6875rem] font-bold uppercase tracking-wide text-rio-slate">{title}</legend>
      <div className="mt-1 space-y-0.5">
        {options.map((option) => (
          <label key={option.value} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-rio-navy transition-colors hover:bg-rio-blush/60">
            <input
              type="checkbox"
              checked={filters[category].includes(option.value)}
              onChange={() => onToggle(category, option.value)}
              className="h-4 w-4 shrink-0 accent-rio-rose"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const itemClass = "btn btn-outline min-h-11 !w-full !justify-start !text-left !gap-3 !rounded-xl !border-0 !px-3 !py-2 text-sm hover:!bg-rio-blush";

// View is open to every administrator; everything that changes a judge is shown to the Super Admin only (the API refuses anyone else regardless).
function JudgeRowActions({ judge, canManage, onPick }: { judge: AdminJudgeRow; canManage: boolean; onPick: OnPick }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu is drawn in a portal with fixed positioning, so no card, table or overflow container can clip it and it never changes the layout.
  // It sits above the button with its right edge on the button, and flips below only when there is more room there.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const button = buttonRef.current;
      const menu = menuRef.current;
      if (!button || !menu) return;
      const gap = 8;
      const edge = 8;
      const rect = button.getBoundingClientRect();
      menu.style.maxHeight = "none";
      const wanted = menu.scrollHeight;
      const above = rect.top - gap - edge;
      const below = window.innerHeight - rect.bottom - gap - edge;
      const useAbove = wanted <= above || above >= below;
      const room = Math.max(120, useAbove ? above : below);
      const height = Math.min(wanted, room);
      menu.style.maxHeight = `${room}px`;
      menu.style.top = `${useAbove ? rect.top - gap - height : rect.bottom + gap}px`;
      menu.style.left = `${Math.max(edge, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - edge))}px`;
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = new ResizeObserver(place);
    if (menuRef.current) observer.observe(menuRef.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer.disconnect();
    };
  }, [open]);

  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

  function pick(kind: DialogKind) {
    setOpen(false);
    buttonRef.current?.focus();
    onPick(kind, judge);
  }

  return (
    <div className="inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Actions for ${judge.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-rio-rose/20 bg-rio-blush/50 text-xl font-bold leading-none text-rio-navy transition-colors hover:bg-rio-blush focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rio-rose"
      >
        <span aria-hidden="true">⋮</span>
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" aria-label={`Actions for ${judge.name}`} className="fixed left-0 top-0 z-50 w-[17rem] max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-rio-navy/10 bg-white p-2 shadow-xl shadow-rio-navy/15">
          <div role="none">
            <button type="button" role="menuitem" onClick={() => pick("view")} className={itemClass}><Icon name="info" className="h-5 w-5" /><span className="flex min-w-0 flex-col text-left leading-snug"><span>{M.view.en}</span><span lang="ta" className="text-xs font-medium">{M.view.ta}</span></span></button>
          </div>
          {canManage && (
            <>
              <div role="none" className="mt-1">
                <button type="button" role="menuitem" onClick={() => pick("edit")} className={itemClass}><Icon name="edit" className="h-5 w-5" /><span className="flex min-w-0 flex-col text-left leading-snug"><span>{M.edit.en}</span><span lang="ta" className="text-xs font-medium">{M.edit.ta}</span></span></button>
              </div>
              <div role="none" className="mt-1">
                <button type="button" role="menuitem" onClick={() => pick("status")} className={itemClass}><Icon name={judge.active ? "lock" : "check"} className="h-5 w-5" /><span className="flex min-w-0 flex-col text-left leading-snug"><span>{(judge.active ? M.deactivate : M.activate).en}</span><span lang="ta" className="text-xs font-medium">{(judge.active ? M.deactivate : M.activate).ta}</span></span></button>
              </div>
              <div role="none" className="mt-1">
                <button type="button" role="menuitem" onClick={() => pick("reset")} className={itemClass}><Icon name="userCog" className="h-5 w-5" /><span className="flex min-w-0 flex-col text-left leading-snug"><span>{M.reset.en}</span><span lang="ta" className="text-xs font-medium">{M.reset.ta}</span></span></button>
              </div>
              <div role="none" className="mt-1 border-t border-rio-navy/10 pt-1">
                <button type="button" role="menuitem" onClick={() => pick("delete")} className={`${itemClass} !text-rio-error`}><Icon name="trash" className="h-5 w-5" /><span className="flex min-w-0 flex-col text-left leading-snug"><span>{M.remove.en}</span><span lang="ta" className="text-xs font-medium">{M.remove.ta}</span></span></button>
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function JudgeRoster({ judges: serverJudges, canManage, heading }: { judges: AdminJudgeRow[]; canManage: boolean; heading?: React.ReactNode }) {
  // Edits and deletions update this copy straight away; a fresh list from the server (after Deactivate, say) replaces it.
  const [judges, setJudges] = useState(serverJudges);
  const [seen, setSeen] = useState(serverJudges);
  if (seen !== serverJudges) {
    setSeen(serverJudges);
    setJudges(serverJudges);
  }
  const [dialog, setDialog] = useState<DialogState>(null);
  const [sort, setSort] = useState("newest");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<FilterState>(EMPTY_FILTERS);
  const filterRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  // Fixed position, above the button by default; it flips below only when there is more room there, and is capped to the viewport.
  useLayoutEffect(() => {
    if (!filterOpen) return;
    function place() {
      const button = filterButtonRef.current;
      const menu = filterMenuRef.current;
      if (!button || !menu) return;
      const gap = 8;
      const edge = 8;
      const rect = button.getBoundingClientRect();
      menu.style.maxHeight = "none";
      const wanted = menu.scrollHeight;
      const above = rect.top - gap - edge;
      const below = window.innerHeight - rect.bottom - gap - edge;
      const useAbove = wanted <= above || above >= below;
      const room = Math.max(160, useAbove ? above : below);
      const height = Math.min(wanted, room);
      menu.style.maxHeight = `${room}px`;
      menu.style.top = `${useAbove ? rect.top - gap - height : rect.bottom + gap}px`;
      menu.style.left = `${Math.max(edge, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - edge))}px`;
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [filterOpen]);

  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setFilterOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const filteredJudges = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const matching = judges.filter((judge) => {
      const matchesSearch = !query || [judge.name, judge.email, judge.judgeCode].some((value) => value.toLocaleLowerCase().includes(query));
      const status = judge.active ? "active" : "inactive";
      const password = judge.mustChangePassword ? "must-change" : "normal";
      const progress = judge.assigned === 0 ? "none" : judge.final >= judge.assigned ? "complete" : "partial";
      const drafts = judge.drafts > 0 ? "has" : "none";
      return matchesSearch && selectedMatches(appliedFilters.status, status) && selectedMatches(appliedFilters.password, password) && selectedMatches(appliedFilters.progress, progress) && selectedMatches(appliedFilters.drafts, drafts);
    });
    return matching.sort(SORTS[sort]!.compare);
  }, [appliedFilters, judges, search, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredJudges.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleJudges = filteredJudges.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const activeFilterCount = Object.values(appliedFilters).reduce((count, values) => count + values.length, 0);

  function toggleFilter(category: keyof FilterState, value: string) {
    setDraftFilters((current) => {
      const values = current[category];
      const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
      return { ...current, [category]: next };
    });
  }

  function openFilters() {
    setDraftFilters(copyFilters(appliedFilters));
    setFilterOpen((current) => !current);
  }

  function applyFilters() {
    setAppliedFilters(copyFilters(draftFilters));
    setPage(1);
    setFilterOpen(false);
  }

  function clearFilters() {
    setAppliedFilters(EMPTY_FILTERS);
    setDraftFilters(EMPTY_FILTERS);
    setPage(1);
    setFilterOpen(false);
  }

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {heading}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative block min-w-0 sm:w-64">
            <span className="sr-only">Search judges</span>
            <Icon name="list" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-rio-slate" />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search judges..."
              aria-label="Search judges"
              className="field h-11 min-h-11 rounded-full pl-9 pr-3 text-sm"
            />
          </label>
          <label className="block min-w-0 sm:w-44">
            <span className="sr-only">Order by</span>
            <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} aria-label="Order by" className="field h-11 min-h-11 rounded-full px-4 text-sm">
              {Object.entries(SORTS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
            </select>
          </label>
          <div ref={filterRef} className="relative">
            <button
              ref={filterButtonRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={filterOpen}
              onClick={openFilters}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-rio-navy/20 bg-white px-4 text-sm font-semibold text-rio-navy transition-colors hover:border-rio-rose hover:bg-rio-blush focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rio-rose sm:w-auto"
            >
              <Icon name="list" className="h-4 w-4" />
              <span>Filter</span>
              {activeFilterCount > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-rio-rose px-1.5 text-xs text-white">{activeFilterCount}</span>}
              <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform ${filterOpen ? "rotate-[-90deg]" : "rotate-90"}`} />
            </button>
            {filterOpen && (
              <div ref={filterMenuRef} role="menu" aria-label="Judge filters" className="fixed left-0 top-0 z-50 w-[30rem] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-2xl border border-rio-navy/10 bg-white p-3 shadow-xl shadow-rio-navy/15">
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 sm:items-start">
                  <div className="space-y-3">
                    <FilterGroup title="Account status" category="status" options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} filters={draftFilters} onToggle={toggleFilter} />
                    <FilterGroup title="Password state" category="password" options={[{ value: "must-change", label: "Must change password" }, { value: "normal", label: "Normal / Password updated" }]} filters={draftFilters} onToggle={toggleFilter} />
                  </div>
                  <div className="space-y-3">
                    <FilterGroup title="Scoring progress" category="progress" options={[{ value: "none", label: "No entries assigned" }, { value: "partial", label: "In progress" }, { value: "complete", label: "All scored" }]} filters={draftFilters} onToggle={toggleFilter} />
                    <FilterGroup title="Draft scores" category="drafts" options={[{ value: "has", label: "Has drafts" }, { value: "none", label: "No drafts" }]} filters={draftFilters} onToggle={toggleFilter} />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-rio-navy/10 pt-2">
                  <button type="button" onClick={clearFilters} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-rio-slate hover:bg-rio-blush hover:text-rio-navy">Clear all</button>
                  <button type="button" onClick={applyFilters} className="btn btn-primary min-h-9 !px-3 !py-1.5 text-xs">Apply filters</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs font-medium text-rio-slate" role="status">Showing {filteredJudges.length} of {judges.length} judges</p>

      {visibleJudges.length === 0 ? (
        <p role="status" className="mt-4 rounded-xl bg-rio-mist px-4 py-3 text-sm leading-snug text-rio-slate">
          No judges match the current search and filters.
        </p>
      ) : (
        <div className="mt-4">
          <table className="w-full border-separate border-spacing-0 text-left text-[0.8125rem] text-rio-ink">
            <thead className="hidden bg-rio-blush text-xs uppercase tracking-wide text-rio-navy lg:table-header-group">
              <tr>
                <th scope="col" className="w-[24%] rounded-l-xl px-3 py-2.5 font-bold">Judge / Code<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">நடுவர் / குறியீடு</span></th>
                <th scope="col" className="w-[30%] px-3 py-2.5 font-bold">Email<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">மின்னஞ்சல்</span></th>
                <th scope="col" className="w-[10rem] px-3 py-2.5 font-bold">Status<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">நிலை</span></th>
                <th scope="col" className="px-3 py-2.5 font-bold">Progress (Scored)<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">முன்னேற்றம்</span></th>
                <th scope="col" className="w-[5rem] rounded-r-xl px-3 py-2.5 font-bold lg:text-right">Actions<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">செயல்கள்</span></th>
              </tr>
            </thead>
            <tbody className="block space-y-3 lg:table-row-group lg:divide-y lg:divide-rio-navy/10">
              {visibleJudges.map((judge) => (
                <tr key={judge.id} className="block rounded-2xl border border-rio-navy/10 bg-white p-3 shadow-sm transition-colors hover:border-rio-rose/20 hover:bg-rio-blush/30 sm:p-4 lg:table-row lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
                  <td className="block py-2 lg:table-cell lg:py-2.5 lg:px-3">
                    <span className="mb-1 block text-[0.6875rem] font-bold uppercase tracking-wide text-rio-slate lg:hidden">Judge / Code</span>
                    <span className="block font-semibold leading-snug text-rio-navy [overflow-wrap:anywhere]">{judge.name}</span>
                    <span className="mt-1 block font-mono text-xs text-rio-slate [overflow-wrap:anywhere]">{judge.judgeCode}</span>
                  </td>
                  <td className="block border-t border-rio-navy/10 py-2 lg:table-cell lg:border-0 lg:px-3 lg:py-2.5">
                    <span className="mb-1 block text-[0.6875rem] font-bold uppercase tracking-wide text-rio-slate lg:hidden">Email</span>
                    <span className="block font-mono text-xs text-rio-slate [overflow-wrap:anywhere]">{judge.email}</span>
                    {judge.mustChangePassword && <span className="mt-1 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[0.6875rem] font-bold text-amber-700">Must change password</span>}
                  </td>
                  <td className="block border-t border-rio-navy/10 py-2 lg:table-cell lg:border-0 lg:px-3 lg:py-2.5">
                    <span className="mb-1 block text-[0.6875rem] font-bold uppercase tracking-wide text-rio-slate lg:hidden">Status</span>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${judge.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-rio-slate"}`}>{judge.active ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="block border-t border-rio-navy/10 py-2 lg:table-cell lg:border-0 lg:px-3 lg:py-2.5">
                    <span className="mb-1 block text-[0.6875rem] font-bold uppercase tracking-wide text-rio-slate lg:hidden">Progress (Scored)</span>
                    <span className="font-semibold text-rio-navy">{judge.final} / {judge.assigned}</span>
                    <span className="block text-xs leading-snug text-rio-slate">{judge.progress !== null ? `${judge.progress}% completed` : "No entries"} · {judge.drafts} draft{judge.drafts === 1 ? "" : "s"}</span>
                  </td>
                  <td className="block border-t border-rio-navy/10 pt-3 lg:table-cell lg:border-0 lg:py-2.5 lg:px-3 lg:text-right">
                    <span className="mb-2 block text-[0.6875rem] font-bold uppercase tracking-wide text-rio-slate lg:hidden">Actions</span>
                    <span className="flex flex-wrap items-center gap-2 lg:justify-end"><JudgeRowActions judge={judge} canManage={canManage} onPick={(kind, target) => setDialog({ kind, judge: target })} /></span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pageCount > 1 && (
            <nav aria-label="Judge roster pages" className="mt-5 flex items-center justify-center gap-2">
              <button type="button" aria-label="Previous page" disabled={safePage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rio-rose/25 text-rio-navy disabled:opacity-40"><span aria-hidden="true">‹</span></button>
              <span className="px-2 text-sm font-semibold text-rio-navy">Page {safePage} of {pageCount}</span>
              <button type="button" aria-label="Next page" disabled={safePage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rio-rose/25 text-rio-navy disabled:opacity-40"><span aria-hidden="true">›</span></button>
            </nav>
          )}
        </div>
      )}
      {dialog?.kind === "view" && <ViewJudgeDialog judge={dialog.judge} onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && (
        <EditJudgeDialog
          judge={dialog.judge}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setJudges((rows) => rows.map((row) => (row.id === dialog.judge.id ? { ...row, name: saved.name, email: saved.email } : row)));
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "status" && (
        <DeactivateJudgeDialog
          judge={dialog.judge}
          onClose={() => setDialog(null)}
          onChanged={(active) => {
            setJudges((rows) => rows.map((row) => (row.id === dialog.judge.id ? { ...row, active } : row)));
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "reset" && <ResetJudgeDialog judge={dialog.judge} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <DeleteJudgeDialog
          judge={dialog.judge}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setJudges((rows) => rows.filter((row) => row.id !== dialog.judge.id));
            setDialog(null);
          }}
        />
      )}
    </>
  );
}
