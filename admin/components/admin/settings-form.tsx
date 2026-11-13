"use client";

import { useActionState, useState } from "react";
import { saveSettingsAction } from "@/app/admin/settings/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import { Icon } from "@/components/ui/icon";
import { fieldMessages, fieldsOf, type ApiSettings, type FieldName, type FormError } from "@/lib/event-settings/settings";

// Event settings form. Times are typed in Asia/Kolkata. The API is the authority on every rule; `openMin` only steers the date picker.

const FORM_ERRORS: Record<FormError, { en: string; ta: string }> = {
  forbidden: { en: "Only an administrator can change these settings.", ta: "நிர்வாகி மட்டுமே இந்த அமைப்புகளை மாற்ற முடியும்." },
  signin: { en: "Your session ended. Sign in again.", ta: "உங்கள் அமர்வு முடிந்தது. மீண்டும் உள்நுழையுங்கள்." },
  published: { en: "Results are already published and cannot be rescheduled.", ta: "முடிவுகள் ஏற்கெனவே வெளியிடப்பட்டன; மாற்ற முடியாது." },
  invalid: { en: "Some values need fixing. Nothing was saved.", ta: "சில மதிப்புகளைத் திருத்த வேண்டும். எதுவும் சேமிக்கப்படவில்லை." },
  unavailable: { en: "The server is not reachable right now. Nothing was saved. Try again.", ta: "சேவையகத்தை இப்போது அணுக முடியவில்லை. எதுவும் சேமிக்கப்படவில்லை." },
};

type FieldDefinition = { name: FieldName; en: string; ta: string; type: "datetime-local" | "text"; help?: string };
const FIELD_GROUPS: { en: string; ta: string; description: string; fields: FieldDefinition[] }[] = [
  {
    en: "Registration settings",
    ta: "பதிவு அமைப்புகள்",
    description: "Control when registrations can be opened and closed.",
    fields: [
      { name: "opensAt", en: "Registration opens (IST)", ta: "பதிவு தொடங்கும் நேரம்", type: "datetime-local" },
      { name: "closesAt", en: "Registration closes (IST)", ta: "பதிவு முடியும் நேரம்", type: "datetime-local" },
    ],
  },
  {
    en: "Consent settings",
    ta: "ஒப்புதல் அமைப்புகள்",
    description: "Reference the approved guardian consent version without editing its wording here.",
    fields: [
      { name: "guardianConsentVersion", en: "Guardian consent version", ta: "பெற்றோர் ஒப்புதல் பதிப்பு", type: "text", help: "A version label such as the one in the approved consent text. The wording itself is not edited here." },
    ],
  },
  {
    en: "Results settings",
    ta: "முடிவு அமைப்புகள்",
    description: "Schedule publication only; the existing approval and publication gate remains in force.",
    fields: [
      { name: "resultsPublishAt", en: "Results published at (IST)", ta: "முடிவுகள் வெளியாகும் நேரம்", type: "datetime-local", help: "Only a schedule. Nothing is published until an administrator approves the winners." },
    ],
  },
];

export function SettingsForm({ settings, openMin }: { settings: ApiSettings; openMin: string }) {
  const [state, action] = useActionState(saveSettingsAction, undefined);
  const shown = state?.ok ? state.settings : settings;
  // Controlled, so a rejected save keeps what the administrator typed (an uncontrolled form is reset after every action).
  const [values, setValues] = useState(() => fieldsOf(settings));
  const fieldErrors = state && !state.ok ? (state.fields ?? {}) : {};

  return (
    <form action={action} noValidate className="space-y-5">
      <p className="flex items-start gap-3 rounded-2xl bg-rio-mist p-3 font-semibold text-rio-navy">
        <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
        <span>
          Registration is <strong>{shown.registrationOpen ? "open" : "closed"}</strong>. It opens only inside a saved window. Times are in India Standard Time ({shown.timezone}). Clear both times to keep it closed.
          <span lang="ta" className="mt-1 block text-sm font-medium">பதிவு {shown.registrationOpen ? "திறந்துள்ளது" : "மூடப்பட்டுள்ளது"}. நேரங்கள் இந்திய நேரத்தில் (IST).</span>
        </span>
      </p>

      {FIELD_GROUPS.map((group) => (
        <section key={group.en} className="rounded-2xl border border-rio-navy/10 bg-white p-4 sm:p-5">
          <div>
            <h2 className="text-base font-bold text-rio-navy">{group.en} <span lang="ta" className="font-medium text-rio-slate">/ {group.ta}</span></h2>
            <p className="mt-1 text-sm leading-relaxed text-rio-slate">{group.description}</p>
          </div>
          <div className={`mt-4 grid gap-4 ${group.fields.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {group.fields.map((f) => {
              const code = fieldErrors[f.name];
              const message = code ? (fieldMessages[code] ?? { en: "This value is not accepted.", ta: "இந்த மதிப்பு ஏற்கப்படவில்லை." }) : null;
              const described = [f.help ? `${f.name}-help` : "", message ? `${f.name}-error` : ""].filter(Boolean).join(" ") || undefined;
              return (
                <div key={f.name}>
                  <label htmlFor={f.name} className="block font-semibold text-rio-navy">
                    {f.en} <span lang="ta" className="font-medium text-rio-slate">/ {f.ta}</span>
                  </label>
                  <input
                    id={f.name}
                    name={f.name}
                    type={f.type}
                    value={values[f.name]}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                    min={f.name === "opensAt" ? openMin : undefined}
                    maxLength={f.type === "text" ? 40 : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={message ? true : undefined}
                    aria-describedby={described}
                    className="field mt-2"
                  />
                  {f.help && <p id={`${f.name}-help`} className="mt-1 text-sm text-rio-slate">{f.help}</p>}
                  {message && (
                    <p id={`${f.name}-error`} role="alert" className="mt-1 font-semibold text-rio-error">
                      {message.en} <span lang="ta" className="block font-medium">{message.ta}</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div aria-live="polite">
        {state?.ok && (
          <p role="status" className="flex items-start gap-2 font-semibold text-rio-ok">
            <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0" />
            <span>Settings saved. Registration is {state.settings.registrationOpen ? "open" : "closed"}. <span lang="ta" className="font-medium">சேமிக்கப்பட்டது.</span></span>
          </p>
        )}
        {state && !state.ok && (
          <p role="alert" className="font-semibold text-rio-error">
            {FORM_ERRORS[state.error].en} <span lang="ta" className="block font-medium">{FORM_ERRORS[state.error].ta}</span>
          </p>
        )}
      </div>
      <SubmitButton idle={{ en: "Save settings", ta: "அமைப்புகளைச் சேமி" }} busy={{ en: "Saving…", ta: "சேமிக்கிறது…" }} />
    </form>
  );
}
