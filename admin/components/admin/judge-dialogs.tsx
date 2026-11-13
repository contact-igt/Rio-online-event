"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { deleteJudge, purgeJudge, resetJudgePassword, restoreJudge, setJudgeActive, updateJudge } from "@/app/admin/judges/actions";
import { CredentialsPanel } from "@/components/admin/credentials-panel";
import type { AdminJudgeRow, DeletedJudgeRow } from "@/lib/admin/api";
import { staff } from "@/lib/staff/messages";

// The three roster dialogs: read-only details, edit (name and e-mail only) and delete confirmation. The server actions behind Edit and Delete
// check the Super Admin role again; these screens only decide what is shown. Nothing here displays a password or hash: the API never sends one.

const M = staff.judges;
const bilingual = (m: { ta: string; en: string }) => `${m.en} / ${m.ta}`;

function Shell({ title, onClose, children }: { title: { ta: string; en: string }; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input, button")?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled])")];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-rio-navy/40 p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={bilingual(title)} className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl shadow-rio-navy/30 sm:p-6">
        <h2 className="text-lg font-semibold leading-snug text-rio-navy">
          <span lang="ta" className="block">{title.ta}</span>
          <span lang="en" className="block text-sm font-medium text-rio-slate">{title.en}</span>
        </h2>
        {children}
      </div>
    </div>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "Never");

export function ViewJudgeDialog({ judge, onClose }: { judge: AdminJudgeRow; onClose: () => void }) {
  const rows: [string, string][] = [
    ["Name", judge.name],
    ["Judge code", judge.judgeCode],
    ["Email", judge.email],
    ["Status", judge.active ? "Active" : "Inactive"],
    ["Password change required", judge.mustChangePassword ? "Yes" : "No"],
    ["Last login", when(judge.lastLoginAt)],
    ["Scoring progress", `${judge.final} of ${judge.assigned} scored · ${judge.drafts} draft${judge.drafts === 1 ? "" : "s"}`],
    ["Assigned entries", String(judge.assigned)],
  ];
  return (
    <Shell title={M.detailsTitle} onClose={onClose}>
      <dl className="mt-4 divide-y divide-rio-navy/10 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 py-2">
            <dt className="font-bold text-rio-slate">{label}</dt>
            <dd className="font-semibold text-rio-navy [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className="btn btn-outline min-h-11 !px-4 !py-1 text-sm">{bilingual(M.close)}</button>
      </div>
    </Shell>
  );
}

export function EditJudgeDialog({ judge, onClose, onSaved }: { judge: AdminJudgeRow; onClose: () => void; onSaved: (saved: { name: string; email: string }) => void }) {
  const [name, setName] = useState(judge.name);
  const [email, setEmail] = useState(judge.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inflight.current) return;
    const displayName = name.trim();
    const mail = email.trim().toLowerCase();
    if (!displayName || displayName.length > 80 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(mail)) return setError(M.actionErrors.invalid);
    inflight.current = true;
    setBusy(true);
    setError(null);
    const result = await updateJudge({ judgeId: String(judge.id), displayName, email: mail }).catch(() => null);
    inflight.current = false;
    setBusy(false);
    if (!result) return setError(M.actionErrors.unavailable);
    if (!result.ok) return setError(M.actionErrors[result.code]);
    onSaved({ name: result.name, email: result.email });
  }

  return (
    <Shell title={M.editTitle} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate className="mt-3 space-y-4">
        <p className="text-sm text-rio-slate">{M.editNote}</p>
        <label className="block text-sm font-semibold text-rio-navy">
          {M.name.en} / <span lang="ta">{M.name.ta}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required className="field mt-1 min-h-12" autoComplete="off" />
        </label>
        <label className="block text-sm font-semibold text-rio-navy">
          {M.email.en} / <span lang="ta">{M.email.ta}</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" maxLength={254} required className="field mt-1 min-h-12" autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </label>
        {error && <p role="alert" className="text-sm font-semibold text-rio-error">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-outline min-h-11 !px-4 !py-1 text-sm">{bilingual(M.cancel)}</button>
          <button type="submit" disabled={busy} aria-busy={busy} className="btn btn-primary min-h-11 !px-4 !py-1 text-sm">{bilingual(busy ? M.saving : M.save)}</button>
        </div>
      </form>
    </Shell>
  );
}

export function DeleteJudgeDialog({ judge, onClose, onDeleted }: { judge: AdminJudgeRow; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  async function run() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const result = await deleteJudge({ judgeId: String(judge.id) }).catch(() => null);
    inflight.current = false;
    setBusy(false);
    if (!result) return setError(M.actionErrors.unavailable);
    if (!result.ok) return setError(M.actionErrors[result.code]);
    onDeleted();
  }

  return (
    <Shell title={M.deleteTitle} onClose={onClose}>
      <p className="mt-3 font-semibold text-rio-navy [overflow-wrap:anywhere]">
        {judge.name} <span className="font-mono text-xs text-rio-slate">{judge.judgeCode}</span>
      </p>
      <p className="mt-2 text-sm text-rio-slate">{M.deleteWarning}</p>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-rio-error">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="btn btn-outline min-h-11 !px-4 !py-1 text-sm">{bilingual(M.cancel)}</button>
        <button type="button" onClick={() => void run()} disabled={busy} aria-busy={busy} className="btn btn-primary min-h-11 !px-4 !py-1 text-sm">{bilingual(busy ? M.deleting : M.deleteYes)}</button>
      </div>
    </Shell>
  );
}

export function DeactivateJudgeDialog({ judge, onClose, onChanged }: { judge: AdminJudgeRow; onClose: () => void; onChanged: (active: boolean) => void }) {
  const next = !judge.active;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  async function run() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const result = await setJudgeActive({ judgeId: String(judge.id), active: next, confirmed: next ? undefined : true }).catch(() => null);
    inflight.current = false;
    setBusy(false);
    if (!result) return setError(M.errors.unavailable);
    if (!result.ok) return setError(result.code === "invalid" ? M.errors.invalidId : M.errors[result.code]);
    onChanged(next);
  }

  const title = next ? M.activate : M.deactivate;
  return (
    <Shell title={title} onClose={onClose}>
      <p className="mt-3 font-semibold text-rio-navy [overflow-wrap:anywhere]">
        {judge.name} <span className="font-mono text-xs text-rio-slate">{judge.judgeCode}</span>
      </p>
      <p className="mt-2 text-sm text-rio-slate">{next ? M.confirmOn : M.confirmOff}</p>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-rio-error">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="btn btn-outline min-h-11 !px-4 !py-1 text-sm">{bilingual(M.cancel)}</button>
        <button type="button" onClick={() => void run()} disabled={busy} aria-busy={busy} className="btn btn-primary min-h-11 !px-4 !py-1 text-sm">{bilingual(next ? M.confirmOnYes : M.confirmOffYes)}</button>
      </div>
    </Shell>
  );
}

// The new password is shown once, inside this dialog only. While it is on screen, Escape and a click outside do not close the dialog, so it cannot be lost by accident.
export function ResetJudgeDialog({ judge, onClose }: { judge: AdminJudgeRow; onClose: () => void }) {
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  async function run() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const result = await resetJudgePassword({ judgeId: String(judge.id) }).catch(() => null);
    inflight.current = false;
    setBusy(false);
    if (!result) return setError(M.errors.unavailable);
    if (!result.ok) return setError(M.resetErrors[result.code]);
    setPassword(result.password);
  }

  return (
    <Shell title={password === null ? M.reset : M.resetDone} onClose={() => { if (password === null) onClose(); }}>
      {password !== null ? (
        <div className="mt-4"><CredentialsPanel email={judge.email} password={password} onDone={onClose} masked /></div>
      ) : (
        <>
          <p className="mt-3 font-semibold text-rio-navy [overflow-wrap:anywhere]">
            {judge.name} <span className="font-mono text-xs text-rio-slate">{judge.judgeCode}</span>
          </p>
          <p className="mt-2 text-sm text-rio-slate">{M.confirmReset}</p>
          {error && <p role="alert" className="mt-3 text-sm font-semibold text-rio-error">{error}</p>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="btn btn-outline min-h-11 !px-4 !py-1 text-sm">{bilingual(M.cancel)}</button>
            <button type="button" onClick={() => void run()} disabled={busy} aria-busy={busy} className="btn btn-primary min-h-11 !px-4 !py-1 text-sm">{bilingual(busy ? M.resetting : M.confirmResetYes)}</button>
          </div>
        </>
      )}
    </Shell>
  );
}

// The Deleted judges view. Restore brings the account back switched off; purge asks the question and the word DELETE typed by hand, and the API
// refuses it when the judge has any history.
export function RestoreJudgeDialog({ judge, onClose, onDone }: { judge: DeletedJudgeRow; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  async function run() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const result = await restoreJudge({ judgeId: String(judge.id) }).catch(() => null);
    inflight.current = false;
    setBusy(false);
    if (!result) return setError(M.deletedErrors.unavailable);
    if (!result.ok) return setError(M.deletedErrors[result.code]);
    onDone();
  }

  return (
    <Shell title={M.restoreTitle} onClose={busy ? () => undefined : onClose}>
      <p className="mt-3 font-semibold text-rio-navy [overflow-wrap:anywhere]">
        {judge.name} <span className="font-mono text-xs text-rio-slate">{judge.judgeCode}</span>
      </p>
      <p className="mt-2 text-sm text-rio-slate">{M.restoreNote}</p>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-rio-error">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="btn btn-outline min-h-11 !px-4 text-sm">{bilingual(M.cancel)}</button>
        <button type="button" onClick={() => void run()} disabled={busy} aria-busy={busy} className="btn btn-primary min-h-11 !px-4 text-sm">{bilingual(busy ? M.restoring : M.restore)}</button>
      </div>
    </Shell>
  );
}

export function PurgeJudgeDialog({ judge, onClose, onDone }: { judge: DeletedJudgeRow; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const ready = typed === "DELETE";

  async function run() {
    if (!ready || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const result = await purgeJudge({ judgeId: String(judge.id) }).catch(() => null);
    inflight.current = false;
    setBusy(false);
    if (!result) return setError(M.deletedErrors.unavailable);
    if (!result.ok) return setError(M.deletedErrors[result.code]);
    onDone();
  }

  return (
    <Shell title={M.purgeTitle} onClose={busy ? () => undefined : onClose}>
      <p className="mt-3 font-semibold text-rio-navy">{M.purgeAsk}</p>
      <p className="mt-1 text-sm font-semibold text-rio-navy [overflow-wrap:anywhere]">
        {judge.name} <span className="font-mono text-xs text-rio-slate">{judge.judgeCode}</span>
      </p>
      <p className="mt-2 text-sm text-rio-slate">{M.purgeWarning}</p>
      <form onSubmit={(event) => { event.preventDefault(); void run(); }} className="mt-4">
        <label className="block text-xs font-semibold text-rio-navy">
          {M.typeDelete}
          <input value={typed} onChange={(event) => setTyped(event.target.value)} disabled={busy} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="field mt-1 h-11 min-h-11 text-sm" />
        </label>
        {error && <p role="alert" className="mt-3 text-sm font-semibold text-rio-error">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-outline min-h-11 !px-4 text-sm">{bilingual(M.cancel)}</button>
          <button type="submit" disabled={!ready || busy} aria-busy={busy} className="btn btn-primary min-h-11 !px-4 text-sm">{bilingual(busy ? M.purging : M.purge)}</button>
        </div>
      </form>
    </Shell>
  );
}
