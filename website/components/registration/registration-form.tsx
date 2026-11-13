"use client";

import { useActionState } from "react";
import { saveDraft, type SaveState } from "@/app/events/[slug]/register/actions";
import { Bilingual, FieldError } from "@/components/auth/bilingual";
import { SubmitButton } from "@/components/auth/submit-button";
import { Icon, type IconName } from "@/components/ui/icon";
import { reg, type Msg } from "@/lib/registration/messages";
import type { Field } from "@/lib/registration/schemas";
import type { PublicQuestion } from "@/lib/registration/express";

export type FormDraft = {
  id: string;
  childName: string;
  childAge: number;
  parentName: string;
  mobileLocal: string;
  mediaConsent: boolean;
  email?: string;
  answers?: Record<string, string | number | string[] | null>;
};

type Props = {
  event: { slug: string; minAge: number; maxAge: number };
  email?: string;
  questions?: PublicQuestion[];
  consent: { version: string; notice: Msg; guardian: Msg; media: Msg };
  draft: FormDraft | null;
  action?: (prev: SaveState, formData: FormData) => Promise<SaveState>;
  initialState?: SaveState;
};

const inputBase =
  "mt-2 block w-full min-h-[3.25rem] rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base text-rio-ink shadow-2xs transition placeholder:text-slate-400 hover:border-slate-300 focus:border-rio-rose focus:ring-4 focus:ring-rio-rose/10 focus:outline-none";

const tagRequired = (
  <span className="ml-2 inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-xs font-bold text-rio-rose ring-1 ring-inset ring-rose-500/20">
    Required / கட்டாயம்
  </span>
);

const tagOptional = (
  <span className="ml-2 inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-rio-slate">
    Optional / விருப்பம்
  </span>
);

function SectionTitle({ m, number }: { icon?: IconName; m: Msg; number: number }) {
  return (
    <div className="flex items-center gap-3 border-b border-rio-navy/10 pb-3 pt-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-rio-rose text-white text-sm font-bold shadow-xs">
        {number}
      </span>
      <h3 className="font-heading text-lg font-bold text-rio-navy">
        {m.ta} <span lang="en" className="font-sans text-sm font-semibold text-rio-slate ml-1">/ {m.en}</span>
      </h3>
    </div>
  );
}

export function RegistrationForm({ event, questions = [], consent, draft, action: submitAction = saveDraft, initialState }: Props) {
  const [state, action] = useActionState(submitAction, initialState);
  const v = state?.values;
  const initialAge = draft ? String(draft.childAge) : "";
  const age = v?.childAge ?? initialAge;
  const editing = draft !== null;
  const err = (f: Field) => state?.fieldErrors?.[f];
  const ages = Array.from({ length: event.maxAge - event.minAge + 1 }, (_, i) => event.minAge + i);
  const aria = (f: Field) => ({ "aria-invalid": Boolean(err(f)), "aria-describedby": err(f) ? `${f}-error` : undefined });

  return (
    <form action={action} noValidate className="space-y-8">
      <input type="hidden" name="event" value={event.slug} />
      <input type="hidden" name="consentVersion" value={consent.version} />
      {draft && <input type="hidden" name="draftId" value={draft.id} />}

      {/* 1. CHILD INFORMATION */}
      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 shadow-xs">
        <SectionTitle number={1} icon="smile" m={reg.form.childSection} />

        {/* 1.1 Child's Name */}
        <div>
          <label htmlFor="childName" className="block text-sm sm:text-base font-bold text-rio-navy">
            <Bilingual m={reg.form.childName} />
            {tagRequired}
          </label>
          <input
            id="childName"
            name="childName"
            type="text"
            autoComplete="off"
            required
            maxLength={80}
            placeholder="Enter child's full name / குழந்தையின் பெயர்"
            defaultValue={v?.childName ?? draft?.childName ?? ""}
            className={inputBase}
            {...aria("childName")}
          />
          {err("childName") && <FieldError id="childName-error" m={err("childName")!} />}
        </div>

        {/* 1.2 Child's Age (stacked directly below name) */}
        <div>
          <label htmlFor="childAge" className="block text-sm sm:text-base font-bold text-rio-navy">
            <Bilingual m={reg.form.childAge} />
            {tagRequired}
          </label>
          <select
            key={age}
            id="childAge"
            name="childAge"
            required
            defaultValue={age}
            className={`${inputBase} cursor-pointer`}
            {...aria("childAge")}
          >
            <option value="" disabled>
              {reg.form.agePlaceholder.ta} / {reg.form.agePlaceholder.en}
            </option>
            {ages.map((a) => (
              <option key={a} value={a}>
                {a} years / {a} வயது
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-rio-slate">
            <Bilingual m={reg.form.ageHelp(event.minAge, event.maxAge)} />
          </p>
          {err("childAge") && <FieldError id="childAge-error" m={err("childAge")!} />}
        </div>
      </section>

      {/* 2. PARENT / GUARDIAN DETAILS */}
      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 shadow-xs">
        <SectionTitle number={2} icon="users" m={reg.form.parentSection} />

        {/* 2.1 Parent's Name */}
        <div>
          <label htmlFor="parentName" className="block text-sm sm:text-base font-bold text-rio-navy">
            <Bilingual m={reg.form.parentName} />
            {tagRequired}
          </label>
          <input
            id="parentName"
            name="parentName"
            type="text"
            autoComplete="name"
            required
            maxLength={80}
            placeholder="Enter parent or guardian's name / பெற்றோர் பெயர்"
            defaultValue={v?.parentName ?? draft?.parentName ?? ""}
            className={inputBase}
            {...aria("parentName")}
          />
          {err("parentName") && <FieldError id="parentName-error" m={err("parentName")!} />}
        </div>

        {/* 2.2 Mobile Number */}
        <div>
          <label htmlFor="mobile" className="block text-sm sm:text-base font-bold text-rio-navy">
            <Bilingual m={reg.form.mobile} />
            {tagRequired}
          </label>
          <div className="mt-2 flex items-stretch rounded-xl border-2 border-slate-200 overflow-hidden shadow-2xs transition focus-within:border-rio-rose focus-within:ring-4 focus-within:ring-rio-rose/10 hover:border-slate-300">
            <span className="flex items-center justify-center bg-slate-50 px-4 font-bold text-rio-navy border-r border-slate-200 text-base select-none">
              +91
            </span>
            <input
              id="mobile"
              name="mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              required
              maxLength={10}
              placeholder="10-digit mobile number / கைப்பேசி எண்"
              defaultValue={v?.mobile ?? draft?.mobileLocal ?? ""}
              className="w-full min-h-[3.25rem] bg-white px-4 py-3 text-base text-rio-ink focus:outline-none"
              {...aria("mobile")}
            />
          </div>
          <p className="mt-1.5 text-xs text-rio-slate">
            <Bilingual m={reg.form.mobileHelp} />
          </p>
          {err("mobile") && <FieldError id="mobile-error" m={err("mobile")!} />}
        </div>

        {/* 2.3 Email Address */}
        <div>
          <label htmlFor="guardianEmail" className="block text-sm sm:text-base font-bold text-rio-navy">
            <Bilingual m={reg.form.email} />
            {tagOptional}
          </label>
          <input
            id="guardianEmail"
            name="guardianEmail"
            type="email"
            autoComplete="email"
            maxLength={254}
            placeholder="e.g. parent@example.com (optional)"
            defaultValue={draft?.email ?? ""}
            className={inputBase}
          />
          <p className="mt-1.5 text-xs text-rio-slate">
            Optional: For entry confirmation and updates / விருப்பம்: மின்னஞ்சல் உறுதிப்படுத்தல்
          </p>
        </div>
      </section>

      {/* 3. COMPETITION QUESTIONS (Stacked one-by-one) */}
      {questions.length > 0 && (
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 shadow-xs">
          <SectionTitle number={3} icon="edit" m={{ ta: "முகவரி & பள்ளி விவரங்கள்", en: "Address, School & Additional Details" }} />

          <div className="space-y-5">
            {questions.map((q) => {
              const value = state?.answers && q.key in state.answers ? state.answers[q.key] : draft?.answers?.[q.key];
              const problem = state?.fieldErrors?.[`answer_${q.key}`];
              const input = `answer_${q.key}`;
              const isChecked = (code: string) => Array.isArray(value) && value.includes(code);

              return (
                <div key={q.key} className="space-y-2 rounded-xl border border-slate-200/90 bg-slate-50/50 p-4 sm:p-5">
                  <input type="hidden" name={`questionType_${q.key}`} value={q.type} />
                  {q.type === "instruction" ? (
                    <div className="text-rio-navy">
                      <p className="font-bold text-base">{q.promptTa}</p>
                      <p lang="en" className="text-sm font-medium text-rio-slate mt-0.5">{q.promptEn}</p>
                    </div>
                  ) : (
                    <>
                      <label htmlFor={input} className="block text-sm sm:text-base font-bold text-rio-navy">
                        <span>{q.promptTa}</span>
                        <span lang="en" className="text-rio-slate font-medium text-xs sm:text-sm ml-1">/ {q.promptEn}</span>
                        {q.required ? tagRequired : tagOptional}
                      </label>
                      {(q.helpTa || q.helpEn) && (
                        <p className="text-xs text-rio-slate">
                          {q.helpTa}
                          {q.helpEn && <span lang="en" className="ml-1">({q.helpEn})</span>}
                        </p>
                      )}

                      {/* Short text */}
                      {q.type === "short_text" && (
                        <input
                          id={input}
                          name={input}
                          type="text"
                          defaultValue={typeof value === "string" ? value : ""}
                          maxLength={q.maxLength ?? undefined}
                          className={inputBase}
                        />
                      )}

                      {/* Paragraph */}
                      {q.type === "paragraph" && (
                        <textarea
                          id={input}
                          name={input}
                          defaultValue={typeof value === "string" ? value : ""}
                          maxLength={q.maxLength ?? undefined}
                          rows={3}
                          className={`${inputBase} min-h-[5.5rem] resize-y leading-relaxed`}
                        />
                      )}

                      {/* Number */}
                      {q.type === "number" && (
                        <input
                          id={input}
                          name={input}
                          type="number"
                          inputMode="numeric"
                          defaultValue={typeof value === "number" ? value : ""}
                          min={q.minNumber ?? undefined}
                          max={q.maxNumber ?? undefined}
                          // Whole-number bounds (a PIN code: 100000 to 999999) ask for a whole number: the phone shows the number pad and no decimals.
                          step={q.minNumber !== null && q.maxNumber !== null && Number.isInteger(q.minNumber) && Number.isInteger(q.maxNumber) ? 1 : "any"}
                          className={inputBase}
                        />
                      )}

                      {/* Dropdown */}
                      {q.type === "dropdown" && (
                        <select
                          key={String(value ?? "")}
                          id={input}
                          name={input}
                          defaultValue={typeof value === "string" ? value : ""}
                          className={`${inputBase} cursor-pointer`}
                        >
                          <option value="">Choose / தேர்ந்தெடுக்கவும்</option>
                          {q.options?.map((o) => (
                            <option key={o.code} value={o.code}>
                              {o.ta} / {o.en}
                            </option>
                          ))}
                        </select>
                      )}

                      {/* Radio buttons / Checkboxes */}
                      {(q.type === "radio" || q.type === "checkboxes") && (
                        <div className="space-y-2 pt-1">
                          {q.options?.map((o) => (
                            <label
                              key={o.code}
                              className="flex items-center gap-3 rounded-xl border-2 border-slate-200 bg-white p-3.5 shadow-2xs transition hover:border-rio-rose cursor-pointer"
                            >
                              <input
                                type={q.type === "radio" ? "radio" : "checkbox"}
                                name={input}
                                value={o.code}
                                defaultChecked={q.type === "checkboxes" ? isChecked(o.code) : value === o.code}
                                className="size-5 shrink-0 accent-rio-rose"
                              />
                              <span className="text-sm font-semibold text-rio-navy">
                                {o.ta} <span lang="en" className="text-xs text-rio-slate font-medium">/ {o.en}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}

                      {problem && <FieldError id={`${input}-error`} m={problem} />}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4. DECLARATION & CONSENT */}
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 shadow-xs">
        <SectionTitle number={questions.length > 0 ? 4 : 3} icon="check" m={reg.form.consentTitle} />

        {editing ? (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 font-semibold text-emerald-800 flex items-center gap-2">
            <Icon name="check" className="h-5 w-5 shrink-0" />
            <Bilingual m={reg.form.consentGiven} />
          </div>
        ) : (
          <label className="flex items-start gap-3.5 rounded-xl border-2 border-slate-200 bg-white p-4 shadow-2xs transition hover:border-rio-rose cursor-pointer">
            <input
              type="checkbox"
              name="guardianConsent"
              defaultChecked={v?.guardianConsent === "on"}
              required
              className="mt-1 size-5 shrink-0 accent-rio-rose"
              {...aria("guardianConsent")}
            />
            <div className="min-w-0">
              <strong className="text-rio-rose text-sm font-bold block">
                {reg.form.required.ta} <span lang="en">/ {reg.form.required.en}</span>
              </strong>
              <p className="mt-1 text-xs sm:text-sm leading-relaxed text-rio-navy">
                {consent.guardian.ta}
              </p>
              <p lang="en" className="mt-0.5 text-xs text-rio-slate leading-relaxed">
                {consent.guardian.en}
              </p>
            </div>
          </label>
        )}
        {err("guardianConsent") && <FieldError id="guardianConsent-error" m={err("guardianConsent")!} />}

        <label className="flex items-start gap-3.5 rounded-xl border-2 border-slate-200 bg-white p-4 shadow-2xs transition hover:border-rio-rose cursor-pointer">
          <input
            type="checkbox"
            name="mediaConsent"
            defaultChecked={v ? v.mediaConsent === "on" : (draft?.mediaConsent ?? false)}
            className="mt-1 size-5 shrink-0 accent-rio-rose"
          />
          <div className="min-w-0">
            <strong className="text-rio-navy text-sm font-bold block">
              {reg.form.optional.ta} <span lang="en" className="text-rio-slate font-medium">/ {reg.form.optional.en}</span>
            </strong>
            <p className="mt-1 text-xs sm:text-sm leading-relaxed text-rio-navy">
              {consent.media.ta}
            </p>
            <p lang="en" className="mt-0.5 text-xs text-rio-slate leading-relaxed">
              {consent.media.en}
            </p>
          </div>
        </label>
      </section>

      {state?.error && <FieldError id="form-error" m={state.error} />}

      {/* ONE-TIME SUBMIT BUTTON */}
      <div className="pt-2">
        <SubmitButton
          idle={{ ta: "பதிவு செய்", en: "Submit Registration" }}
          busy={{ ta: "பதிவு செய்யப்படுகிறது…", en: "Submitting registration…" }}
        />
      </div>
    </form>
  );
}
