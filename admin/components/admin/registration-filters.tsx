"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";

// The Registrations filter bar. The URL is the single source of truth (the server page reads it and asks the API), so this component only
// builds the next URL: search after a short pause, the dropdowns at once, and the advanced popup only when Apply is pressed.
// Every change drops `page`, so results always start on page 1.

export type RegistrationFilterValues = { q: string; competition: string; status: string; sort: string; video: string; dup: boolean };
type Props = {
  initial: RegistrationFilterValues;
  competitions: { slug: string; nameEn: string; nameTa: string }[];
  statuses: Record<string, string>;
  sorts: Record<string, string>;
};

const EMPTY_DRAFT = { up: false, none: false, dup: false };
const DEBOUNCE_MS = 300;

function toUrl(v: RegistrationFilterValues): string {
  const q = new URLSearchParams();
  if (v.q.trim()) q.set("q", v.q.trim());
  if (v.competition) q.set("competition", v.competition);
  if (v.status) q.set("status", v.status);
  if (v.sort && v.sort !== "newest") q.set("sort", v.sort);
  if (v.video) q.set("video", v.video);
  if (v.dup) q.set("duplicate", "1");
  return `/admin/registrations${q.size > 0 ? `?${q}` : ""}`;
}

export function RegistrationFilters({ initial, competitions, statuses, sorts }: Props) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const valuesRef = useRef(values);
  const [pushed, setPushed] = useState(toUrl(initial)); // the URL this component last asked for
  const pushedRef = useRef(pushed);
  useEffect(() => { valuesRef.current = values; pushedRef.current = pushed; });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Back/forward or a pagination link changed the URL from outside: adopt it, but never overwrite what is being typed.
  const [seen, setSeen] = useState(toUrl(initial));
  if (seen !== toUrl(initial)) {
    setSeen(toUrl(initial));
    if (toUrl(initial) !== pushed) {
      setPushed(toUrl(initial));
      setValues(initial);
    }
  }

  function go(next: RegistrationFilterValues) {
    valuesRef.current = next;
    setValues(next);
    const url = toUrl(next);
    if (url === pushedRef.current) return; // nothing changed: no second request
    pushedRef.current = url;
    setPushed(url);
    router.replace(url, { scroll: false });
  }
  function change(patch: Partial<RegistrationFilterValues>) {
    go({ ...valuesRef.current, ...patch });
  }
  function onSearch(text: string) {
    setValues((current) => ({ ...current, q: text }));
    valuesRef.current = { ...valuesRef.current, q: text };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(valuesRef.current), DEBOUNCE_MS);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // ---- advanced popup: draft values until Apply
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const applied = (values.video ? 1 : 0) + (values.dup ? 1 : 0);
  const anyActive = Boolean(values.q.trim() || values.competition || values.status || values.video || values.dup || (values.sort && values.sort !== "newest"));

  function toggleOpen() {
    if (!open) setDraft({ up: values.video === "uploaded", none: values.video === "none", dup: values.dup });
    setOpen((current) => !current);
  }
  // The API takes one video value: ticking exactly one box filters, ticking both (or neither) means any video state.
  const videoOf = (d: typeof EMPTY_DRAFT) => (d.up && !d.none ? "uploaded" : d.none && !d.up ? "none" : "");

  function apply() {
    change({ video: videoOf(draft), dup: draft.dup });
    setOpen(false);
  }
  function clearAdvanced() {
    setDraft(EMPTY_DRAFT);
    change({ video: "", dup: false });
    setOpen(false);
  }
  function clearAll() {
    setDraft(EMPTY_DRAFT);
    go({ q: "", competition: "", status: "", sort: "newest", video: "", dup: false });
  }

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  // Fixed position, above the button by default, flipping below only when there is more room there; never wider than the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const button = buttonRef.current;
      const menu = popRef.current;
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
      menu.style.maxHeight = `${room}px`;
      menu.style.top = `${useAbove ? rect.top - gap - Math.min(wanted, room) : rect.bottom + gap}px`;
      menu.style.left = `${Math.max(edge, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - edge))}px`;
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  const label = "block text-xs font-semibold leading-snug text-rio-navy";
  const check = "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-rio-navy hover:bg-rio-blush/60";

  return (
    <div>
      <h2 className="flex items-center gap-2 text-sm font-bold leading-snug text-rio-navy">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rio-blush text-rio-rose"><Icon name="filter" className="h-4 w-4" /></span>
        <span>Filter registrations <span lang="ta" className="font-medium text-rio-slate">/ பதிவுகளை வடிகட்டு</span></span>
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <div>
          <label htmlFor="q" className={label}>Search <span lang="ta" className="font-medium text-rio-slate">/ தேடு</span></label>
          <input id="q" type="search" value={values.q} onChange={(event) => onSearch(event.target.value)} maxLength={80} placeholder="Reference, child or guardian name" autoComplete="off" className="field mt-1 h-11 min-h-11 text-sm" />
        </div>
        <div>
          <label htmlFor="competition" className={label}>Competition <span lang="ta" className="font-medium text-rio-slate">/ போட்டி</span></label>
          <select id="competition" value={values.competition} onChange={(event) => change({ competition: event.target.value })} className="field mt-1 h-11 min-h-11 text-sm">
            <option value="">All competitions</option>
            {competitions.map((c) => <option key={c.slug} value={c.slug}>{c.nameEn} / {c.nameTa}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="status" className={label}>Registration status <span lang="ta" className="font-medium text-rio-slate">/ நிலை</span></label>
          <select id="status" value={values.status} onChange={(event) => change({ status: event.target.value })} className="field mt-1 h-11 min-h-11 text-sm">
            <option value="">Any status</option>
            {Object.entries(statuses).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sort" className={label}>Order by <span lang="ta" className="font-medium text-rio-slate">/ வரிசை</span></label>
          <select id="sort" value={values.sort || "newest"} onChange={(event) => change({ sort: event.target.value })} className="field mt-1 h-11 min-h-11 text-sm">
            {Object.entries(sorts).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </div>
        <div ref={wrapRef} className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
          <button ref={buttonRef} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={toggleOpen} className="btn btn-primary h-11 min-h-11 flex-1 !px-5 text-sm lg:flex-none">
            <Icon name="filter" className="h-5 w-5" />Filter <span lang="ta" className="font-medium">/ வடிகட்டு</span>
            {applied > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-rio-rose">{applied}</span>}
          </button>
          {anyActive && <button type="button" onClick={clearAll} className="btn btn-outline h-11 min-h-11 !px-4 text-sm">Clear <span lang="ta" className="font-medium">/ அழி</span></button>}
          {open && (
            <div ref={popRef} role="dialog" aria-label="Advanced registration filters" className="fixed left-0 top-0 z-50 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-2xl border border-rio-navy/10 bg-white p-3 shadow-xl shadow-rio-navy/15">
              <fieldset>
                <legend className="text-[0.6875rem] font-bold uppercase tracking-wide text-rio-slate">Video status <span lang="ta" className="normal-case">/ வீடியோ</span></legend>
                <label className={check}><input type="checkbox" checked={draft.up} onChange={(event) => setDraft((current) => ({ ...current, up: event.target.checked }))} className="h-4 w-4 shrink-0 accent-rio-rose" /><span>Video uploaded</span></label>
                <label className={check}><input type="checkbox" checked={draft.none} onChange={(event) => setDraft((current) => ({ ...current, none: event.target.checked }))} className="h-4 w-4 shrink-0 accent-rio-rose" /><span>No video yet</span></label>
              </fieldset>
              <fieldset className="mt-2">
                <legend className="text-[0.6875rem] font-bold uppercase tracking-wide text-rio-slate">Review <span lang="ta" className="normal-case">/ மதிப்பாய்வு</span></legend>
                <label className={check}><input type="checkbox" checked={draft.dup} onChange={(event) => setDraft((current) => ({ ...current, dup: event.target.checked }))} className="h-4 w-4 shrink-0 accent-rio-rose" /><span>Possible duplicate</span></label>
              </fieldset>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-rio-navy/10 pt-2">
                <button type="button" onClick={clearAdvanced} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-rio-slate hover:bg-rio-blush hover:text-rio-navy">Clear all</button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-rio-navy hover:bg-rio-blush">Cancel</button>
                  <button type="button" onClick={apply} className="btn btn-primary min-h-9 !px-3 !py-1.5 text-xs">Apply filters</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
