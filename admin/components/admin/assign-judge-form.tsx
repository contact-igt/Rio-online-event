"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { assignJudge } from "@/app/admin/actions";
import { Bilingual, FieldError } from "@/components/auth/bilingual";
import type { Msg } from "@/lib/auth/messages";
import { staff } from "@/lib/staff/messages";

// Tick the judges for this competition (owner, 2026-11-13: "add three judges to one event") and assign them together. Each ticked judge gets
// every submitted entry; the API call is safe to repeat, so judges already on the competition start ticked and pressing Assign again also
// gives them entries submitted since. Unticking does not remove a judge: the API has no unassign, and the help text says so.
type Judge = { id: string; name: string; assigned?: boolean };
type Done = { name: string; added: number };
type State = { kind: "idle" } | { kind: "saving" } | { kind: "done"; results: Done[] } | { kind: "failed"; message: Msg; results: Done[] };
const E = staff.admin.assignErrors;

export function AssignJudgeForm({ slug, judges }: { slug: string; judges: Judge[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(judges.filter((j) => j.assigned).map((j) => j.id)));
  const [state, setState] = useState<State>({ kind: "idle" });
  const inflight = useRef(false);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function submit() {
    const chosen = judges.filter((j) => picked.has(j.id));
    if (inflight.current || chosen.length === 0) return;
    inflight.current = true;
    setState({ kind: "saving" });
    const results: Done[] = [];
    // One judge at a time: the audit log gets one entry per judge, and a failure stops before the next one with what was done so far shown.
    for (const judge of chosen) {
      const result = await assignJudge({ slug, judgeId: judge.id }).catch(() => null);
      if (!result || !result.ok) {
        inflight.current = false;
        setState({ kind: "failed", message: !result ? E.network : (E[result.code] ?? E.unavailable), results });
        if (results.length) router.refresh();
        return;
      }
      results.push({ name: judge.name, added: result.added });
    }
    inflight.current = false;
    setState({ kind: "done", results });
    router.refresh();
  }

  if (!judges.length) return <p className="text-rio-slate">No active judge yet. Add one on the Judges page first.</p>;
  const saving = state.kind === "saving";
  const results = state.kind === "done" || state.kind === "failed" ? state.results : [];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-3"
    >
      <fieldset id={`judge-${slug}`} disabled={saving} aria-describedby={`judge-help-${slug}`}>
        <legend className="font-semibold text-rio-navy">Judges <span lang="ta" className="font-medium">/ நடுவர்கள்</span></legend>
        <p id={`judge-help-${slug}`} className="mt-1 text-sm text-rio-slate">
          <Bilingual m={staff.admin.assignHelp} />
        </p>
        <ul className="mt-3 grid gap-2">
          {judges.map((j) => {
            const on = picked.has(j.id);
            return (
              <li key={j.id}>
                <label
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors duration-150 ${on ? "border-rio-rose/40 bg-rio-blush" : "border-rio-navy/15 bg-white hover:border-rio-navy/30"}`}
                >
                  <input type="checkbox" name="judgeId" value={j.id} checked={on} onChange={() => toggle(j.id)} className="h-5 w-5 shrink-0 accent-rio-rose" />
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="break-words font-semibold text-rio-navy">{j.name}</span>
                    {j.assigned && <span className="rounded-full bg-rio-mist px-2 py-0.5 text-xs font-semibold text-rio-navy">Assigned / ஒதுக்கப்பட்டவர்</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      {state.kind === "failed" && <FieldError id={`assign-error-${slug}`} m={state.message} />}
      {results.length > 0 && (
        <ul role="status" className="space-y-1 text-sm font-semibold text-rio-ok">
          {results.map((r) => (
            <li key={r.name}>
              {r.name}: {r.added === 0 ? "already has every submitted entry / ஏற்கனவே எல்லாப் பதிவுகளும் உள்ளன" : `${r.added} entries added / ${r.added} பதிவுகள் சேர்க்கப்பட்டன`}
            </li>
          ))}
        </ul>
      )}
      <button type="submit" disabled={saving || picked.size === 0} aria-busy={saving} className="btn btn-primary w-full sm:w-auto">
        <span>{staff.admin.assign.ta}</span>
        <span lang="en" className="font-medium">{picked.size > 0 ? `Assign ${picked.size} judge${picked.size === 1 ? "" : "s"}` : staff.admin.assign.en}</span>
      </button>
    </form>
  );
}
