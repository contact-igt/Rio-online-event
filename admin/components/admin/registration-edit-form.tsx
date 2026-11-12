"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { updateRegistration } from "@/app/admin/registrations/actions";
import type { RegistrationEditData } from "@/lib/admin/api";

// Edit mode of the existing registration detail page. Only the five draft fields can change; the server action and the API check the role,
// the draft status and every value again. Cancel discards the form and goes back to the read-only view without calling the server.

const errors: Record<string, string> = {
  sessionExpired: "Your session has expired. Sign in again.",
  notAllowed: "You are not allowed to perform this action.",
  invalid: "Check the details: name, age 1 to 18, a valid mobile number and e-mail address.",
  notFound: "This registration no longer exists. Reload the page.",
  protected: "Only an eligible draft registration can be changed.",
  unavailable: "The registration could not be saved right now. Try again.",
};

const fields = [
  { key: "childName", label: "Child name", ta: "குழந்தையின் பெயர்", type: "text" },
  { key: "childAge", label: "Child age", ta: "வயது", type: "number" },
  { key: "guardianName", label: "Guardian name", ta: "பாதுகாவலர் பெயர்", type: "text" },
  { key: "guardianMobile", label: "Guardian mobile", ta: "கைப்பேசி", type: "tel" },
  { key: "guardianEmail", label: "Guardian email", ta: "மின்னஞ்சல்", type: "email" },
] as const;

export function RegistrationEditForm({ entryCode, initial }: { entryCode: string; initial: RegistrationEditData }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const result = await updateRegistration(entryCode, {
      childName: form.childName.trim(),
      childAge: Number(form.childAge),
      guardianName: form.guardianName.trim(),
      guardianMobile: form.guardianMobile.trim(),
      guardianEmail: form.guardianEmail?.trim().toLowerCase() || null,
    }).catch(() => null);
    inflight.current = false;
    if (!result) { setBusy(false); return setError(errors.unavailable); }
    if (!result.ok) { setBusy(false); return setError(errors[result.code] ?? errors.unavailable); }
    router.push("/admin/registrations?notice=updated");
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="card mt-6 p-4 sm:p-6" aria-label="Edit registration">
      <h2 className="font-display text-2xl font-bold text-rio-navy">Edit registration <span lang="ta" className="font-medium">/ பதிவைத் திருத்து</span></h2>
      <p className="mt-1 text-sm text-rio-slate">Only these draft details can be changed. The reference, competition, consent and video stay as they are.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="block text-sm font-semibold text-rio-navy">
            {f.label} <span lang="ta" className="font-medium text-rio-slate">/ {f.ta}</span>
            <input
              className="field mt-1 min-h-11"
              type={f.type}
              inputMode={f.type === "number" ? "numeric" : undefined}
              value={form[f.key] ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, [f.key]: f.key === "childAge" ? Number(event.target.value) : event.target.value }))}
              disabled={busy}
              required={f.key !== "guardianEmail"}
              autoComplete="off"
            />
          </label>
        ))}
      </div>
      {error && <p role="alert" className="mt-4 text-sm font-semibold text-rio-error">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => router.push(`/admin/registrations/${entryCode}`)} disabled={busy} className="btn btn-outline min-h-11 !px-4 text-sm">Cancel <span lang="ta" className="font-medium">/ ரத்து</span></button>
        <button type="submit" disabled={busy} aria-busy={busy} className="btn btn-primary min-h-11 !px-4 text-sm">{busy ? "Saving…" : "Save changes"} <span lang="ta" className="font-medium">/ {busy ? "சேமிக்கிறது…" : "மாற்றங்களைச் சேமி"}</span></button>
      </div>
    </form>
  );
}
