"use client";

import { useActionState } from "react";
import { recoverDraft, type SaveState } from "@/app/events/[slug]/register/actions";
import { FieldError } from "@/components/auth/bilingual";
import { SubmitButton } from "@/components/auth/submit-button";
import { Icon } from "@/components/ui/icon";

// Compact collapsible recovery form: doesn't clutter the screen for first-time parents.
export function RecoveryForm({ event }: { event: string }) {
  const [state, action] = useActionState(recoverDraft, undefined as SaveState);

  return (
    <details className="group rounded-2xl border border-slate-200 bg-white shadow-2xs transition overflow-hidden">
      <summary className="flex items-center justify-between p-4 sm:px-6 cursor-pointer list-none hover:bg-slate-50 transition-colors">
        <div className="flex items-center gap-3">
          <span className="grid size-8 place-items-center rounded-lg bg-rio-mist text-rio-navy">
            <Icon name="lock" className="h-4 w-4" />
          </span>
          <div className="text-left">
            <span className="text-sm font-bold text-rio-navy">
              Already started registration? Resume draft
            </span>
            <span lang="ta" className="block text-xs font-medium text-rio-slate">
              ஏற்கெனவே தொடங்கிய வரைவைத் திறக்க
            </span>
          </div>
        </div>
        <span className="text-xs font-bold text-rio-rose group-open:rotate-180 transition-transform select-none">
          ▼
        </span>
      </summary>

      <form action={action} className="p-4 sm:p-6 border-t border-slate-100 bg-slate-50/60 space-y-4">
        <p className="text-xs sm:text-sm text-rio-slate leading-relaxed">
          Enter the recovery code given when you created your draft to resume and upload your video.
          <span lang="ta" className="block mt-0.5 text-xs">முன்பு சேமித்த வரைவின் மீட்புக் குறியீட்டை உள்ளிட்டு தொடரலாம்.</span>
        </p>

        <input type="hidden" name="event" value={event} />

        <div>
          <label htmlFor="recoveryCode" className="block text-xs sm:text-sm font-bold text-rio-navy mb-1.5">
            Recovery code / மீட்புக் குறியீடு
          </label>
          <input
            id="recoveryCode"
            name="recoveryCode"
            inputMode="text"
            autoComplete="one-time-code"
            maxLength={29}
            placeholder="e.g. apple-banana-cherry..."
            className="w-full min-h-[3rem] rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-base font-mono text-rio-navy focus:border-rio-rose focus:ring-4 focus:ring-rio-rose/10 focus:outline-none"
            required
          />
        </div>

        {state?.error && <FieldError id="recovery-error" m={state.error} />}

        <div className="pt-1">
          <SubmitButton idle={{ ta: "வரைவைத் திற", en: "Open draft" }} busy={{ ta: "திறக்கிறது…", en: "Opening…" }} />
        </div>
      </form>
    </details>
  );
}
