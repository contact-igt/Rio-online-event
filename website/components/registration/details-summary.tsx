import Link from "next/link";
import { Bilingual } from "@/components/auth/bilingual";
import type { PublicQuestion, RegistrationView } from "@/lib/registration/express";
import { reg } from "@/lib/registration/messages";

// The saved details, short, in place of the whole form: after saving, the parent's next step (the video) comes straight after this instead of
// below a long form again. "Edit details" reopens the form while the entry is still a draft; after submission it is read only.

function answerText(q: PublicQuestion, value: RegistrationView["answers"][string] | undefined): string | null {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  if (q.options) {
    const codes = Array.isArray(value) ? value : [String(value)];
    return q.options.filter((o) => codes.includes(o.code)).map((o) => `${o.ta} / ${o.en}`).join(", ") || null;
  }
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function Row({ label, children }: { label: { ta: string; en: string }; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-4 py-2.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      <dt className="text-sm text-rio-slate">
        <span lang="ta" className="block font-semibold text-rio-navy">{label.ta}</span>
        <span lang="en">{label.en}</span>
      </dt>
      <dd className="min-w-0 font-semibold text-rio-navy [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function DetailsSummary({ view, editHref }: { view: RegistrationView; editHref: string | null }) {
  const questions = view.questionSet.questions.filter((q) => q.type !== "instruction");
  return (
    <section id="details" aria-labelledby="details-title" className="scroll-mt-4 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="details-title" className="text-xl font-bold text-rio-navy">
          {reg.summary.title.ta} <span lang="en" className="font-semibold text-rio-slate">/ {reg.summary.title.en}</span>
        </h2>
        {editHref && (
          <Link href={editHref} className="btn btn-outline min-h-11 w-full sm:w-auto">
            <span>{reg.summary.edit.ta}</span>
            <span lang="en" className="font-medium">{reg.summary.edit.en}</span>
          </Link>
        )}
      </div>
      <dl className="mt-3 divide-y divide-slate-100">
        <Row label={reg.summary.child}>{view.child.name}, {view.child.age} <span lang="ta">{reg.summary.years.ta}</span> / <span lang="en">{reg.summary.years.en}</span></Row>
        <Row label={reg.summary.guardian}>{view.guardian.name}</Row>
        <Row label={reg.summary.mobile}><span className="tabular-nums">{view.guardian.mobile}</span></Row>
        {view.guardian.email && <Row label={reg.summary.email}>{view.guardian.email}</Row>}
        {questions.map((q) => {
          const text = answerText(q, view.answers[q.key]);
          return (
            <Row key={q.key} label={{ ta: q.promptTa, en: q.promptEn }}>
              {text ?? <span className="font-medium text-rio-slate"><Bilingual m={reg.summary.notAnswered} /></span>}
            </Row>
          );
        })}
      </dl>
      {!editHref && (
        <p className="mt-2 text-sm text-rio-slate">
          <Bilingual m={reg.summary.locked} />
        </p>
      )}
    </section>
  );
}
