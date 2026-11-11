import type { PreviewQuestion } from "@/lib/question-builder/types";

// What a parent will see, drawn from the API's preview response. Nothing here can be filled in or sent: the controls are disabled, and
// each carries its name in text so the preview is readable without them. Tamil first, English second.

function Controls({ q }: { q: PreviewQuestion }) {
  const note = (text: string) => <p className="mt-1 text-sm text-rio-slate">{text}</p>;
  switch (q.type) {
    case "short_text":
      return (
        <>
          <input disabled aria-label={q.promptEn} className="field mt-2" />
          {q.maxLength !== null && note(`Up to ${q.maxLength} characters`)}
        </>
      );
    case "paragraph":
      return (
        <>
          <textarea disabled aria-label={q.promptEn} className="field mt-2 min-h-[6rem] py-2" />
          {q.maxLength !== null && note(`Up to ${q.maxLength} characters`)}
        </>
      );
    case "dropdown":
      return (
        <select disabled aria-label={q.promptEn} className="field mt-2">
          <option>Choose / தேர்ந்தெடுக்கவும்</option>
          {q.options?.map((o) => <option key={o.code}>{o.ta} / {o.en}</option>)}
        </select>
      );
    case "radio":
    case "checkboxes":
      return (
        <fieldset className="mt-2 space-y-1">
          <legend className="sr-only">{q.promptEn}</legend>
          {q.options?.map((o) => (
            <label key={o.code} className="flex min-h-11 items-center gap-3">
              <input disabled type={q.type === "radio" ? "radio" : "checkbox"} className="h-5 w-5" />
              <span>{o.ta} / <span lang="en">{o.en}</span></span>
            </label>
          ))}
          {q.type === "checkboxes" && (q.minChoices !== null || q.maxChoices !== null) && note(`Choose ${q.minChoices !== null ? `at least ${q.minChoices}` : ""}${q.minChoices !== null && q.maxChoices !== null ? " and " : ""}${q.maxChoices !== null ? `at most ${q.maxChoices}` : ""}`)}
        </fieldset>
      );
    case "number":
      return (
        <>
          <input disabled inputMode="decimal" aria-label={q.promptEn} className="field mt-2 max-w-[12rem]" />
          {(q.minNumber !== null || q.maxNumber !== null) && note(`From ${q.minNumber ?? "any"} to ${q.maxNumber ?? "any"}`)}
        </>
      );
    case "instruction":
      return null;
  }
}

export function QuestionPreview({ questions }: { questions: PreviewQuestion[] }) {
  if (questions.length === 0) {
    return <p className="text-rio-slate">Nothing to show yet. Add an active question. <span lang="ta" className="block text-sm">காட்டுவதற்கு எதுவும் இல்லை.</span></p>;
  }
  return (
    <ol className="space-y-4">
      {questions.map((q) => (
        <li key={q.key} className={q.type === "instruction" ? "rounded-2xl bg-rio-mist p-4" : "rounded-2xl border border-rio-navy/10 bg-white p-4"}>
          <p className="font-semibold text-rio-navy">
            <span lang="ta">{q.promptTa}</span>
            {q.required && <span className="ml-1 text-rio-error" aria-label="required">*</span>}
            <span lang="en" className="block font-medium text-rio-slate">{q.promptEn}</span>
          </p>
          {(q.helpTa || q.helpEn) && (
            <p className="mt-1 text-sm text-rio-slate">
              {q.helpTa && <span lang="ta">{q.helpTa}</span>}
              {q.helpEn && <span lang="en" className="block">{q.helpEn}</span>}
            </p>
          )}
          <Controls q={q} />
        </li>
      ))}
    </ol>
  );
}
