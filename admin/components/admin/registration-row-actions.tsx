"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { deleteRegistration, loadRegistrationForEdit, purgeRegistration, restoreRegistration, updateRegistration, type EditResult } from "@/app/admin/registrations/actions";
import type { DeletedRegistrationRow, RegistrationEditData, RegistrationRow } from "@/lib/admin/api";
import { Icon } from "@/components/ui/icon";

type Dialog = "edit" | "delete" | null;
const actionText: Record<string, string> = {
  sessionExpired: "Your session has expired. Sign in again.",
  notAllowed: "You are not allowed to perform this action.",
  invalid: "Check the highlighted registration details.",
  notFound: "This registration no longer exists. Reload the page.",
  protected: "Only an eligible draft registration can be changed or deleted.",
  blocked: "Other records depend on this registration, so it cannot be permanently deleted.",
  storage: "The stored video could not be removed, so nothing was deleted. Try again later.",
  conflict: "This registration cannot be restored because it conflicts with an existing submitted registration.",
  unavailable: "The registration could not be changed right now. Try again.",
};

// Rendered in a portal on the page body: inside the table the dialog inherited the Actions cell's right alignment. The title is "English / Tamil".
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);
  const [en = title, ta] = title.split(" / ");
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-rio-navy/40 p-4 text-left" onPointerDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl shadow-rio-navy/30 sm:p-6">
        <h2 className="text-lg font-semibold leading-snug text-rio-navy">
          {ta && <span lang="ta" className="block">{ta}</span>}
          <span lang="en" className={ta ? "block text-sm font-medium text-rio-slate" : "block"}>{en}</span>
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function EditDialog({ entryCode, onClose, onSaved }: { entryCode: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<RegistrationEditData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const inflight = useRef(false);

  useEffect(() => {
    let live = true;
    void loadRegistrationForEdit(entryCode).then((result) => {
      if (!live) return;
      setBusy(false);
      if (result.ok) setForm(result.data);
      else setError(actionText[result.code] ?? actionText.unavailable);
    }).catch(() => { if (live) { setBusy(false); setError(actionText.unavailable); } });
    return () => { live = false; };
  }, [entryCode]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const result: EditResult | null = await updateRegistration(entryCode, form).catch(() => null);
    inflight.current = false;
    setBusy(false);
    if (!result) return setError(actionText.unavailable);
    if (!result.ok) return setError(actionText[result.code] ?? actionText.unavailable);
    onSaved();
  }

  const field = (key: keyof RegistrationEditData, en: string, ta: string, type = "text", wide = false) => (
    <label className={`block text-xs font-semibold leading-snug text-rio-navy${wide ? " sm:col-span-2" : ""}`} key={key}>
      {en} <span lang="ta" className="font-medium text-rio-slate">/ {ta}</span>
      <input
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        value={form?.[key] ?? ""}
        onChange={(event) => setForm((current) => current ? { ...current, [key]: type === "number" ? Number(event.target.value) : event.target.value } : current)}
        disabled={busy || !form}
        autoComplete="off"
        className="field mt-1 h-11 min-h-11 text-sm"
      />
    </label>
  );

  return (
    <Modal title="Edit registration / பதிவைத் திருத்து" onClose={busy ? () => undefined : onClose}>
      <p className="mt-1 font-mono text-xs font-bold text-rio-slate">{entryCode}</p>
      {busy && !form && !error && <p className="mt-4 text-sm text-rio-slate">Loading registration…</p>}
      {error && <p role="alert" className="mt-4 text-sm font-semibold text-rio-error">{error}</p>}
      {form && (
        <form onSubmit={(event) => void submit(event)} className="mt-4">
          <p className="text-sm text-rio-slate">Only these draft details can be changed. The reference, competition, consent and video stay as they are.</p>
          <div className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {field("childName", "Child name", "குழந்தையின் பெயர்")}
            {field("childAge", "Child age", "வயது", "number")}
            {field("guardianName", "Guardian name", "பாதுகாவலர் பெயர்")}
            {field("guardianMobile", "Guardian mobile", "கைப்பேசி", "tel")}
            {field("guardianEmail", "Guardian email", "மின்னஞ்சல்", "email", true)}
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-rio-navy/10 pt-4">
            <button type="button" onClick={onClose} disabled={busy} className="btn btn-outline min-h-11 !px-4 text-sm">Cancel <span lang="ta" className="font-medium">/ ரத்து</span></button>
            <button type="submit" disabled={busy} aria-busy={busy} className="btn btn-primary min-h-11 !px-4 text-sm">{busy ? "Saving…" : "Save changes"} <span lang="ta" className="font-medium">/ {busy ? "சேமிக்கிறது…" : "மாற்றங்களைச் சேமி"}</span></button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function DeleteDialog({ registration, onClose, onDeleted }: { registration: RegistrationRow; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  async function confirm() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const result = await deleteRegistration(registration.entryCode).catch(() => null);
    inflight.current = false;
    setBusy(false);
    if (!result) return setError(actionText.unavailable);
    if (!result.ok) return setError(actionText[result.code] ?? actionText.unavailable);
    onDeleted();
  }
  return (
    <Modal title="Delete draft registration / வரைவுப் பதிவை நீக்கு" onClose={busy ? () => undefined : onClose}>
      <p className="mt-4 font-semibold text-rio-navy">{registration.entryCode} · {registration.childName}</p>
      <p className="mt-2 text-sm leading-relaxed text-rio-slate">This draft will leave the normal registration list. Its history, answers, references and video ownership stay preserved. This cannot be undone from this screen.</p>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-rio-error">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="btn btn-outline min-h-11 !px-4">Cancel</button><button type="button" onClick={() => void confirm()} disabled={busy} className="btn btn-primary min-h-11 !px-4">{busy ? "Deleting…" : "Delete draft"}</button></div>
    </Modal>
  );
}

export function RegistrationRowActions({ registration, canDelete }: { registration: RegistrationRow; canDelete: boolean }) {
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [copied, setCopied] = useState(false);
  const editable = registration.status === "draft";

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const width = 208;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    const top = rect.bottom + 6 + 176 > window.innerHeight ? Math.max(8, rect.top - 182) : rect.bottom + 6;
    setPosition({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!button.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  // Copy stays on this page: it only writes the reference to the clipboard (no navigation, no request to the server).
  async function copyReference(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    try {
      await navigator.clipboard.writeText(registration.entryCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  const menuContent = open && typeof document !== "undefined" ? createPortal(
    <div ref={menu} role="menu" className="fixed z-50 w-52 rounded-2xl border border-rio-navy/10 bg-white p-1.5 shadow-xl shadow-rio-navy/15" style={{ top: position.top, left: position.left }}>
      <Link href={`/admin/registrations/${registration.entryCode}`} role="menuitem" onClick={() => setOpen(false)} className="flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-rio-navy hover:bg-rio-blush"><Icon name="eye" className="h-4 w-4" />View registration</Link>
      {editable && <button type="button" role="menuitem" onClick={() => { setOpen(false); setDialog("edit"); }} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold text-rio-navy hover:bg-rio-blush"><Icon name="edit" className="h-4 w-4" />Edit registration</button>}
      <button type="button" role="menuitem" onClick={(event) => void copyReference(event)} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold text-rio-navy hover:bg-rio-blush"><Icon name="clipboard" className="h-4 w-4" />Copy reference</button>
      {canDelete && editable && <button type="button" role="menuitem" onClick={() => { setOpen(false); setDialog("delete"); }} className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold text-rio-rose hover:bg-rio-blush"><Icon name="trash" className="h-4 w-4" />Delete registration</button>}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button ref={button} type="button" aria-label={`Actions for ${registration.entryCode}`} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rio-navy/10 bg-rio-mist text-rio-navy hover:border-rio-rose/30 hover:bg-rio-blush hover:text-rio-rose"><Icon name="more" className="h-5 w-5" /></button>
      {copied && <span role="status" className="ml-2 text-xs font-bold text-rio-ok">Copied</span>}
      {menuContent}
      {dialog === "edit" && <EditDialog entryCode={registration.entryCode} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); router.refresh(); }} />}
      {dialog === "delete" && <DeleteDialog registration={registration} onClose={() => setDialog(null)} onDeleted={() => { setDialog(null); router.refresh(); }} />}
    </>
  );
}

function RestoreDialog({ registration, onClose, onRestored }: { registration: DeletedRegistrationRow; onClose: () => void; onRestored: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  async function confirm() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const result = await restoreRegistration(registration.entryCode).catch(() => null);
    inflight.current = false;
    setBusy(false);
    if (!result) return setError(actionText.unavailable);
    if (!result.ok) return setError(actionText[result.code] ?? actionText.unavailable);
    onRestored();
  }

  return (
    <Modal title="Restore registration / பதிவை மீட்டமை" onClose={busy ? () => undefined : onClose}>
      <p className="mt-4 font-semibold text-rio-navy">{registration.entryCode} · {registration.childName}</p>
      <p className="mt-2 text-sm leading-relaxed text-rio-slate">This draft will return to Active registrations with its original reference, answers, consent history and video ownership. Current registration rules still apply.</p>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-rio-error">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="btn btn-outline min-h-11 !px-4">Cancel</button><button type="button" onClick={() => void confirm()} disabled={busy} className="btn btn-primary min-h-11 !px-4">{busy ? "Restoring…" : "Yes, restore"}</button></div>
    </Modal>
  );
}

// Permanent delete asks twice: the question, and the word DELETE typed by hand. The API still refuses anything that is not a soft-deleted draft.
function PurgeDialog({ registration, onClose, onPurged }: { registration: DeletedRegistrationRow; onClose: () => void; onPurged: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const ready = typed === "DELETE";

  async function confirm() {
    if (!ready || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const result = await purgeRegistration(registration.entryCode).catch(() => null);
    inflight.current = false;
    setBusy(false);
    if (!result) return setError(actionText.unavailable);
    if (!result.ok) return setError(actionText[result.code] ?? actionText.unavailable);
    onPurged();
  }

  return (
    <Modal title="Delete permanently / நிரந்தரமாக நீக்கு" onClose={busy ? () => undefined : onClose}>
      <p className="mt-4 font-semibold text-rio-navy">Do you want to permanently delete this registration?</p>
      <p className="mt-1 font-mono text-xs font-bold text-rio-slate">{registration.entryCode} · {registration.childName}</p>
      <p className="mt-3 text-sm leading-relaxed text-rio-slate">The registration, its answers and its uploaded video are removed for good and cannot be brought back. Only a short audit record with the reference is kept.</p>
      <form onSubmit={(event) => { event.preventDefault(); void confirm(); }} className="mt-4">
        <label className="block text-xs font-semibold text-rio-navy">
          Type DELETE to confirm <span lang="ta" className="font-medium text-rio-slate">/ உறுதிப்படுத்த DELETE என தட்டச்சு செய்க</span>
          <input value={typed} onChange={(event) => setTyped(event.target.value)} disabled={busy} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="field mt-1 h-11 min-h-11 text-sm" />
        </label>
        {error && <p role="alert" className="mt-3 text-sm font-semibold text-rio-error">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-rio-navy/10 pt-4">
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-outline min-h-11 !px-4 text-sm">Cancel <span lang="ta" className="font-medium">/ ரத்து</span></button>
          <button type="submit" disabled={!ready || busy} aria-busy={busy} className="btn btn-primary min-h-11 !px-4 text-sm">{busy ? "Deleting…" : "Delete permanently"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function DeletedRegistrationActions({ registration }: { registration: DeletedRegistrationRow }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"restore" | "purge" | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <button type="button" onClick={() => setDialog("restore")} className="btn btn-outline min-h-9 !px-3 text-xs">Restore</button>
      <button type="button" onClick={() => setDialog("purge")} className="btn btn-outline min-h-9 !px-3 text-xs !border-rio-error/40 !text-rio-error">Delete permanently</button>
      {dialog === "restore" && <RestoreDialog registration={registration} onClose={() => setDialog(null)} onRestored={() => { setDialog(null); router.refresh(); }} />}
      {dialog === "purge" && <PurgeDialog registration={registration} onClose={() => setDialog(null)} onPurged={() => { setDialog(null); router.refresh(); }} />}
    </span>
  );
}
