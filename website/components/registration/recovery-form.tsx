"use client";

import { useActionState } from "react";
import { recoverDraft, type SaveState } from "@/app/events/[slug]/register/actions";
import { FieldError } from "@/components/auth/bilingual";
import { SubmitButton } from "@/components/auth/submit-button";

export function RecoveryForm({ event }: { event: string }) {
  const [state, action] = useActionState(recoverDraft, undefined as SaveState);
  return (
    <form action={action} className="card-soft space-y-3 p-5">
      <h2 className="text-xl font-bold text-rio-navy">Open a saved draft <span lang="ta" className="block text-base font-medium">சேமித்த வரைவைத்திறக்கவும்</span></h2>
      <p className="text-sm text-rio-slate">Use the recovery code shown when you created the draft. It is never used as a name or phone credential.</p>
      <input type="hidden" name="event" value={event} />
      <label htmlFor="recoveryCode" className="block font-semibold text-rio-navy">Recovery code / மீட்புக் குறியீடு</label>
      <input id="recoveryCode" name="recoveryCode" inputMode="text" autoComplete="one-time-code" maxLength={29} className="field" required />
      {state?.error && <FieldError id="recovery-error" m={state.error} />}
      <SubmitButton idle={{ ta: "வரைவைத் திற", en: "Open draft" }} busy={{ ta: "திறக்கிறது…", en: "Opening…" }} />
    </form>
  );
}
