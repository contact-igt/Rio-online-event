"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { saveMyScore } from "@/app/judge/actions";
import { Bilingual, FieldError } from "@/components/auth/bilingual";
import type { Msg } from "@/lib/auth/messages";
import { staff } from "@/lib/staff/messages";

// A judge's own score for one entry: save a draft as often as needed, then submit it as final (after a confirmation). The server
// action and the database decide what is allowed; this screen only shows the state and prevents a double send. Nothing is shown as
// saved until the server has confirmed it, and a final score is never sent without the confirmation step.

export type ScoreFormProps = { entryId: string; marks: number | null; comments: string | null; status: "draft" | "final" | null };
type State = { kind: "editing" } | { kind: "confirming" } | { kind: "saving" } | { kind: "saved"; final: boolean } | { kind: "failed"; message: Msg };
const E = staff.judge.errors;
const input = "field mt-1 text-sm";
/** Every judge marks out of 10 (the API refuses anything else). */
const MAX_MARKS = 10;
const button = "btn min-h-11 w-full !px-4 text-sm sm:w-auto";

export function ScoreForm(p: ScoreFormProps) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "editing" });
  const [marks, setMarks] = useState(p.marks === null ? "" : String(p.marks));
  const [comments, setComments] = useState(p.comments ?? "");
  const inflight = useRef(false);

  if (p.status === "final") {
    return (
      <div className="space-y-2">
        {state.kind === "saved" && state.final && (
          <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
            <Bilingual m={staff.judge.savedFinal} />
          </p>
        )}
        <div className="space-y-2 rounded-xl border-2 border-rio-navy/15 bg-white p-4">
          <p className="font-display text-3xl font-bold tabular-nums text-rio-navy">{p.marks} <span className="text-base font-semibold text-rio-slate">/ {MAX_MARKS}</span></p>
          {p.comments && <p className="whitespace-pre-wrap text-sm text-rio-ink">{p.comments}</p>}
          <p className="text-sm text-rio-slate">
            <Bilingual m={staff.judge.finalLocked} />
          </p>
        </div>
      </div>
    );
  }

  async function save(final: boolean) {
    if (inflight.current) return;
    inflight.current = true;
    setState({ kind: "saving" });
    const result = await saveMyScore({ entryId: p.entryId, marks, comments, final }).catch(() => null);
    inflight.current = false;
    if (!result) return setState({ kind: "failed", message: E.network });
    if (!result.ok) return setState({ kind: "failed", message: E[result.code] ?? E.unavailable });
    setState({ kind: "saved", final: result.status === "final" });
    router.refresh(); // the entry and the dashboard counts are read again from the server
  }

  const busy = state.kind === "saving";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (state.kind !== "confirming") void save(false);
      }}
      noValidate
      className="space-y-4"
    >
      <div>
        <label htmlFor="marks" className="block text-sm font-semibold text-rio-navy">
          <Bilingual m={staff.judge.marks} />
        </label>
        {/* A number field with the maximum beside it, so the judge always sees what the mark is out of. The server checks 0 to 10 again. */}
        <div className="mt-1 flex items-center gap-3">
          <input
            id="marks"
            name="marks"
            type="number"
            inputMode="decimal"
            min={0}
            max={MAX_MARKS}
            step={0.5}
            autoComplete="off"
            value={marks}
            onChange={(e) => setMarks(e.target.value)}
            className="field w-32 text-center font-display text-2xl font-bold tabular-nums"
            aria-describedby={state.kind === "failed" ? "score-error marks-hint" : "marks-hint"}
          />
          <span className="font-display text-2xl font-bold text-rio-slate" aria-hidden="true">/ {MAX_MARKS}</span>
        </div>
        <p id="marks-hint" className="mt-1 text-xs text-rio-slate">{staff.judge.scoreRange}</p>
      </div>
      <div>
        <label htmlFor="comments" className="block text-sm font-semibold text-rio-navy">
          <Bilingual m={staff.judge.comments} />
        </label>
        <textarea id="comments" name="comments" rows={4} maxLength={2000} value={comments} onChange={(e) => setComments(e.target.value)} className={`${input} py-3`} />
      </div>

      {state.kind === "failed" && <FieldError id="score-error" m={state.message} />}
      {state.kind === "saved" && !state.final && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          <Bilingual m={staff.judge.saved} />
        </p>
      )}

      {state.kind === "confirming" ? (
        <div className="space-y-3 rounded-xl border-2 border-rio-navy bg-white p-4">
          <p className="text-sm font-semibold text-rio-navy">
            <Bilingual m={staff.judge.finalWarning} />
          </p>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => void save(true)} className={`${button} btn-primary`}>
              <span>{staff.judge.confirmFinal.ta}</span>
              <span lang="en" className="font-medium">{staff.judge.confirmFinal.en}</span>
            </button>
            <button type="button" onClick={() => setState({ kind: "editing" })} className={`${button} btn-outline`}>
              <span>{staff.judge.cancel.ta}</span>
              <span lang="en" className="font-medium">{staff.judge.cancel.en}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={busy} aria-busy={busy} className={`${button} btn-outline`}>
            <span>{staff.judge.saveDraft.ta}</span>
            <span lang="en" className="font-medium">{staff.judge.saveDraft.en}</span>
          </button>
          <button type="button" disabled={busy} onClick={() => setState({ kind: "confirming" })} className={`${button} btn-primary`}>
            <span>{staff.judge.submitFinal.ta}</span>
            <span lang="en" className="font-medium">{staff.judge.submitFinal.en}</span>
          </button>
        </div>
      )}
    </form>
  );
}
