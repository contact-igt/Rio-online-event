"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveQuestionAction } from "@/app/admin/events/[slug]/questions/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import { Icon } from "@/components/ui/icon";
import { ERROR, fieldMessage, hasOptions, moved, TYPE_LABEL, type FormModel, type OptionDraft } from "@/lib/question-builder/types";

// Add or edit one draft question. Controlled inputs, so a rejected save keeps what was typed. The API validates everything; this form only
// shows its field codes in words, next to the field, in text (not colour alone).

type Props = { slug: string; setId: number; questionId?: number; initial: FormModel };

function Err({ id, code }: { id: string; code: string | undefined }) {
  if (!code) return null;
  const m = fieldMessage(code);
  return (
    <p id={id} role="alert" className="mt-1 font-semibold text-rio-error">
      {m.en} <span lang="ta" className="block font-medium">{m.ta}</span>
    </p>
  );
}

const INVALID = { en: "Some values need fixing. Nothing was saved.", ta: "சில மதிப்புகளைத் திருத்த வேண்டும். எதுவும் சேமிக்கப்படவில்லை." };
const label = "block font-semibold text-rio-navy";
const ta = "field mt-2 min-h-[5rem] py-2 leading-relaxed";

export function QuestionForm({ slug, setId, questionId, initial }: Props) {
  const [m, setM] = useState<FormModel>(initial);
  const [state, run] = useActionState(async () => saveQuestionAction({ slug, setId, ...(questionId === undefined ? {} : { questionId }), form: m }), undefined);
  const fields = state?.fields ?? {};
  const set = <K extends keyof FormModel>(key: K, value: FormModel[K]) => setM((v) => ({ ...v, [key]: value }));
  const setOption = (i: number, patch: Partial<OptionDraft>) => setM((v) => ({ ...v, options: v.options.map((o, at) => (at === i ? { ...o, ...patch } : o)) }));
  const type = TYPE_LABEL[m.type];
  const nameError = (name: string) => fields[name];
  const message = !state || state.error === "invalid" || (!state.error && state.fields) ? INVALID : (ERROR[state.error ?? "other"] ?? ERROR.other!);

  return (
    <form action={run} noValidate className="space-y-5">
      <p className="chip">
        {type.ta} / <span lang="en">{type.en}</span>
      </p>

      {(["promptTa", "promptEn"] as const).map((name) => (
        <div key={name}>
          <label htmlFor={name} className={label}>
            {name === "promptTa" ? "Tamil label / தமிழ் தலைப்பு" : "English label / ஆங்கில தலைப்பு"}
          </label>
          <input id={name} lang={name === "promptTa" ? "ta" : "en"} className="field mt-2" value={m[name]} maxLength={500} autoComplete="off" onChange={(e) => set(name, e.target.value)} aria-invalid={nameError(name) ? true : undefined} aria-describedby={nameError(name) ? `${name}-e` : undefined} />
          <Err id={`${name}-e`} code={nameError(name)} />
        </div>
      ))}
      {(["helpTa", "helpEn"] as const).map((name) => (
        <div key={name}>
          <label htmlFor={name} className={label}>
            {name === "helpTa" ? "Tamil description (optional) / தமிழ் விளக்கம்" : "English description (optional) / ஆங்கில விளக்கம்"}
          </label>
          <textarea id={name} lang={name === "helpTa" ? "ta" : "en"} className={ta} value={m[name]} maxLength={1000} onChange={(e) => set(name, e.target.value)} aria-invalid={nameError(name) ? true : undefined} aria-describedby={nameError(name) ? `${name}-e` : undefined} />
          <Err id={`${name}-e`} code={nameError(name)} />
        </div>
      ))}

      {(m.type === "short_text" || m.type === "paragraph") && (
        <div>
          <label htmlFor="maxLength" className={label}>Longest answer, in characters (optional) / அதிகபட்ச எழுத்துகள்</label>
          <input id="maxLength" inputMode="numeric" className="field mt-2 max-w-[12rem]" value={m.maxLength} onChange={(e) => set("maxLength", e.target.value)} aria-describedby="maxLength-e" />
          <Err id="maxLength-e" code={nameError("maxLength")} />
        </div>
      )}

      {m.type === "number" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(["minNumber", "maxNumber"] as const).map((name) => (
            <div key={name}>
              <label htmlFor={name} className={label}>{name === "minNumber" ? "Smallest number (optional) / குறைந்தபட்சம்" : "Largest number (optional) / அதிகபட்சம்"}</label>
              <input id={name} inputMode="decimal" className="field mt-2" value={m[name]} onChange={(e) => set(name, e.target.value)} aria-describedby={`${name}-e`} />
              <Err id={`${name}-e`} code={nameError(name)} />
            </div>
          ))}
        </div>
      )}

      {hasOptions(m.type) && (
        <fieldset className="rounded-2xl border border-rio-navy/15 p-3 sm:p-4">
          <legend className="px-1 font-semibold text-rio-navy">Options / விருப்பங்கள்</legend>
          <ol className="space-y-3">
            {m.options.map((o, i) => (
              <li key={o.code ?? `new-${i}`} className="rounded-xl bg-rio-mist p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`o-ta-${i}`} className="block text-sm font-semibold text-rio-navy">Option {i + 1} · தமிழ்</label>
                    <input id={`o-ta-${i}`} lang="ta" className="field mt-1" value={o.ta} maxLength={200} onChange={(e) => setOption(i, { ta: e.target.value })} aria-describedby={`o-ta-${i}-e`} />
                    <Err id={`o-ta-${i}-e`} code={nameError(`options.${i}.ta`)} />
                  </div>
                  <div>
                    <label htmlFor={`o-en-${i}`} className="block text-sm font-semibold text-rio-navy">Option {i + 1} · English</label>
                    <input id={`o-en-${i}`} lang="en" className="field mt-1" value={o.en} maxLength={200} onChange={(e) => setOption(i, { en: e.target.value })} aria-describedby={`o-en-${i}-e`} />
                    <Err id={`o-en-${i}-e`} code={nameError(`options.${i}.en`)} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-outline min-h-11" disabled={i === 0} onClick={() => set("options", moved(m.options, i, -1))} aria-label={`Move option ${i + 1} up`}>
                    <Icon name="arrow" className="h-4 w-4 -rotate-90" /> Up
                  </button>
                  <button type="button" className="btn btn-outline min-h-11" disabled={i === m.options.length - 1} onClick={() => set("options", moved(m.options, i, 1))} aria-label={`Move option ${i + 1} down`}>
                    <Icon name="arrow" className="h-4 w-4 rotate-90" /> Down
                  </button>
                  <button type="button" className="btn btn-outline min-h-11" disabled={m.options.length <= 2} onClick={() => set("options", m.options.filter((_, at) => at !== i))} aria-label={`Remove option ${i + 1}`}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <Err id="options-e" code={nameError("options")} />
          <button type="button" className="btn btn-outline mt-3 min-h-11" disabled={m.options.length >= 30} onClick={() => set("options", [...m.options, { ta: "", en: "" }])}>
            Add an option / விருப்பம் சேர்
          </button>
        </fieldset>
      )}

      {m.type === "checkboxes" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(["minChoices", "maxChoices"] as const).map((name) => (
            <div key={name}>
              <label htmlFor={name} className={label}>{name === "minChoices" ? "Fewest choices (optional) / குறைந்தபட்ச தேர்வுகள்" : "Most choices (optional) / அதிகபட்ச தேர்வுகள்"}</label>
              <input id={name} inputMode="numeric" className="field mt-2" value={m[name]} onChange={(e) => set(name, e.target.value)} aria-describedby={`${name}-e`} />
              <Err id={`${name}-e`} code={nameError(name)} />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        {m.type !== "instruction" && (
          <label className="flex min-h-11 items-center gap-3 font-semibold text-rio-navy">
            <input type="checkbox" checked={m.required} onChange={(e) => set("required", e.target.checked)} className="h-6 w-6 accent-rio-rose" />
            Required / அவசியம்
          </label>
        )}
        <label className="flex min-h-11 items-center gap-3 font-semibold text-rio-navy">
          <input type="checkbox" checked={m.active} onChange={(e) => set("active", e.target.checked)} className="h-6 w-6 accent-rio-rose" />
          Active / செயலில்
        </label>
        {!m.active && <p className="text-sm text-rio-slate">An inactive question is kept in this draft but left out of the preview and removed when the draft is published.</p>}
        <Err id="required-e" code={nameError("required")} />
      </div>

      <div aria-live="polite">
        {state && (
          <p role="alert" className="font-semibold text-rio-error">
            {message.en} <span lang="ta" className="block font-medium">{message.ta}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <SubmitButton idle={{ en: "Save question", ta: "கேள்வியைச் சேமி" }} busy={{ en: "Saving…", ta: "சேமிக்கிறது…" }} />
        <Link href={`/admin/events/${slug}/questions`} className="btn btn-outline w-full sm:w-auto">
          Cancel / ரத்து
        </Link>
      </div>
    </form>
  );
}
