import type { Metadata } from "next";
import Link from "next/link";
import { CompetitionLinks } from "@/components/admin/competition-links";
import { PublishPanel } from "@/components/admin/publish-panel";
import { QuestionForm } from "@/components/admin/question-form";
import { QuestionPreview } from "@/components/admin/question-preview";
import { Icon } from "@/components/ui/icon";
import { loadCompetitions } from "@/lib/admin/api";
import { loadPreview, loadSetDetail, loadSetList } from "@/lib/admin/questions-api";
import { requireStaff } from "@/lib/staff/auth";
import { blankForm, ERROR, formOf, NOTICE, PROBLEM_MESSAGE, QUESTION_TYPES, QUESTIONS_PATH, TYPE_LABEL, type Question, type QuestionType, type SetSummary } from "@/lib/question-builder/types";
import { createDraftAction, deleteQuestionAction, discardDraftAction, moveQuestionAction } from "../events/[slug]/questions/actions";

export const metadata: Metadata = { title: "Questions · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

// One question list for every competition. The owner wants the same registration questions everywhere, so the list is edited once, here.
// It is stored as the draft of the first competition (the "home" one) and published, on confirmation, to every active competition at once
// (POST ../publish-all). Each competition still keeps its own published versions, so every entry stays bound to the wording its parent saw.

type Search = { view?: string; new?: string; edit?: string; set?: string; notice?: string; error?: string };
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const STATUS: Record<SetSummary["status"], string> = { draft: "Draft", published: "Published", retired: "Retired" };
const P = QUESTIONS_PATH;

function Banner({ kind, text }: { kind: "ok" | "error"; text: { en: string; ta: string } }) {
  return (
    <p role={kind === "error" ? "alert" : "status"} className={`mt-4 flex items-start gap-3 rounded-2xl border bg-white p-3 font-semibold ${kind === "error" ? "border-rio-error/40 text-rio-error" : "border-rio-ok/40 text-rio-ok"}`}>
      <Icon name={kind === "error" ? "info" : "check"} className="mt-0.5 h-5 w-5 shrink-0" />
      <span>{text.en}<span lang="ta" className="mt-1 block font-medium">{text.ta}</span></span>
    </p>
  );
}

function QuestionCard({ q, index, count, slug, setId, editable }: { q: Question; index: number; count: number; slug: string; setId: number; editable: boolean }) {
  const t = TYPE_LABEL[q.type];
  const hidden = (
    <>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="setId" value={setId} />
      <input type="hidden" name="questionId" value={q.id} />
    </>
  );
  return (
    <li className={`rounded-2xl border bg-white p-4 ${q.active ? "border-rio-navy/10" : "border-dashed border-rio-slate/50"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip">#{index + 1}</span>
        <span className="chip">{t.ta} / <span lang="en">{t.en}</span></span>
        {q.required && <span className="chip">Required</span>}
        {!q.active && <span className="chip">Inactive</span>}
      </div>
      <p className="mt-2 font-semibold text-rio-navy [overflow-wrap:anywhere]">
        <span lang="ta">{q.promptTa}</span>
        <span lang="en" className="block font-medium text-rio-slate">{q.promptEn}</span>
      </p>
      {q.options && <p className="mt-1 text-sm text-rio-slate">{q.options.length} options: {q.options.map((o) => o.ta).join(", ")}</p>}
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={moveQuestionAction}>
            {hidden}<input type="hidden" name="by" value="up" />
            <button type="submit" className="btn btn-outline min-h-11" disabled={index === 0} aria-label={`Move question ${index + 1} up`}><Icon name="arrow" className="h-4 w-4 -rotate-90" /> Up</button>
          </form>
          <form action={moveQuestionAction}>
            {hidden}<input type="hidden" name="by" value="down" />
            <button type="submit" className="btn btn-outline min-h-11" disabled={index === count - 1} aria-label={`Move question ${index + 1} down`}><Icon name="arrow" className="h-4 w-4 rotate-90" /> Down</button>
          </form>
          <Link href={`${P}?edit=${q.id}`} className="btn btn-outline min-h-11" aria-label={`Edit question ${index + 1}`}><Icon name="edit" className="h-4 w-4" /> Edit</Link>
          <details className="min-w-0">
            <summary className="btn btn-outline min-h-11 cursor-pointer list-none">Delete…</summary>
            <form action={deleteQuestionAction} className="mt-2 rounded-xl bg-rio-blush p-3">
              {hidden}
              <p className="text-sm font-semibold text-rio-navy">Delete this question from the draft? / இந்தக் கேள்வியை வரைவிலிருந்து நீக்கவா?</p>
              <button type="submit" className="btn btn-primary mt-2 min-h-11">Yes, delete</button>
            </form>
          </details>
        </div>
      )}
    </li>
  );
}

export default async function AdminQuestionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaff("admin");
  const sp = await searchParams;
  const q: Search = { view: one(sp.view), new: one(sp.new), edit: one(sp.edit), set: one(sp.set), notice: one(sp.notice), error: one(sp.error) };
  const notice = q.notice ? NOTICE[q.notice] : undefined;
  const error = q.error ? (ERROR[q.error] ?? ERROR.other!) : undefined;
  const competitions = await loadCompetitions();

  const shell = (body: React.ReactNode) => (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6 lg:px-8">
      <h1 className="text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold">
        கேள்விகள்
        <span lang="en" className="block text-[0.6em] font-bold text-rio-slate">Questions</span>
      </h1>
      <p className="mt-2 max-w-[65ch] text-rio-slate">
        One list of registration questions for every competition. Edit it once here; publishing sends it to all competitions together.
        <span lang="ta" className="block">எல்லாப் போட்டிகளுக்கும் ஒரே கேள்விப் பட்டியல். இங்கே ஒருமுறை திருத்துங்கள்; வெளியிட்டால் எல்லாப் போட்டிகளுக்கும் ஒன்றாகச் செல்லும்.</span>
      </p>
      {notice && <Banner kind="ok" text={notice} />}
      {error && <Banner kind="error" text={error} />}
      {body}
    </section>
  );

  if (!competitions.ok) return shell(<Banner kind="error" text={ERROR.unavailable!} />);
  const home = competitions.data[0];
  const usedBy = (
    <div className="card mt-6 p-4 sm:p-6">
      <h2 className="font-display text-2xl font-bold text-rio-navy">Used by <span lang="ta" className="font-medium">/ பயன்படுத்தும் போட்டிகள்</span></h2>
      <CompetitionLinks competitions={competitions.data} />
    </div>
  );
  if (!home) return shell(usedBy);

  const slug = home.slug;
  const list = await loadSetList(slug);
  if (!list.ok) return shell(<>{usedBy}<Banner kind="error" text={ERROR.unavailable!} /></>);
  const { sets } = list.data;
  const draft = sets.find((s) => s.status === "draft") ?? null;
  const published = sets.find((s) => s.status === "published") ?? null;
  const chosen = (q.set ? sets.find((s) => String(s.id) === q.set) : undefined) ?? draft ?? published ?? null;
  const names = competitions.data.map((c) => c.nameEn);

  const versions = (
    <div className="card mt-6 p-4 sm:p-6">
      <h2 className="font-display text-2xl font-bold text-rio-navy">Versions <span lang="ta" className="font-medium">/ பதிப்புகள்</span></h2>
      {sets.length === 0 ? (
        <p className="mt-3 text-rio-slate">No questions yet. Create a draft to start. Nothing is shown to parents until you publish.<span lang="ta" className="block text-sm">இன்னும் கேள்விகள் இல்லை. தொடங்க வரைவை உருவாக்குங்கள்.</span></p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {sets.map((s) => (
            <li key={s.id}>
              <Link href={`${P}?set=${s.id}`} aria-current={chosen?.id === s.id ? "page" : undefined} className={`btn min-h-11 ${chosen?.id === s.id ? "btn-primary" : "btn-outline"}`}>
                v{s.version} · {STATUS[s.status]} · {s.questionCount} question{s.questionCount === 1 ? "" : "s"}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!draft && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          {published && (
            <form action={createDraftAction}>
              <input type="hidden" name="slug" value={slug} /><input type="hidden" name="startFrom" value="published" />
              <button type="submit" className="btn btn-primary w-full sm:w-auto"><span>புதிய வரைவு</span><span lang="en" className="font-medium">New draft from v{published.version}</span></button>
            </form>
          )}
          <form action={createDraftAction}>
            <input type="hidden" name="slug" value={slug} /><input type="hidden" name="startFrom" value="blank" />
            <button type="submit" className={`btn w-full sm:w-auto ${published ? "btn-outline" : "btn-primary"}`}><span>வெற்று வரைவு</span><span lang="en" className="font-medium">Blank draft</span></button>
          </form>
        </div>
      )}
      {published && <p className="mt-3 text-sm text-rio-slate">Version numbers are this list&apos;s own. Editing means a new draft; published versions never change, and entries already started keep the wording they were given.</p>}
    </div>
  );

  if (!chosen) return shell(<>{versions}{usedBy}</>);

  const detail = await loadSetDetail(slug, chosen.id);
  if (!detail.ok) return shell(<>{versions}<Banner kind="error" text={ERROR.unavailable!} /></>);
  const questions = detail.data.questions;
  const editable = chosen.status === "draft";
  const editing = editable && q.edit ? questions.find((x) => String(x.id) === q.edit) : undefined;
  const newType = editable && q.new && (QUESTION_TYPES as readonly string[]).includes(q.new) ? (q.new as QuestionType) : undefined;

  if (editing || newType) {
    return shell(
      <>
        {versions}
        <div className="card mt-6 max-w-3xl p-4 sm:p-6">
          <h2 className="font-display text-2xl font-bold text-rio-navy">{editing ? "Edit question" : "Add question"} <span lang="ta" className="font-medium">/ {editing ? "கேள்வியைத் திருத்து" : "கேள்வியைச் சேர்"}</span></h2>
          <div className="mt-4"><QuestionForm key={editing?.id ?? newType} slug={slug} setId={chosen.id} {...(editing ? { questionId: editing.id } : {})} initial={editing ? formOf(editing) : blankForm(newType!)} /></div>
        </div>
      </>,
    );
  }

  const previewing = q.view === "preview";
  const preview = editable || previewing ? await loadPreview(slug, chosen.id) : null;
  const problems = preview && preview.ok ? preview.data.problems : [];
  const activeCount = questions.filter((x) => x.active).length;

  return shell(
    <>
      {versions}
      <div className="card mt-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-bold text-rio-navy">
            Version {chosen.version} · {STATUS[chosen.status]} <span lang="ta" className="font-medium">/ {previewing ? "முன்னோட்டம்" : "கேள்விகள்"}</span>
          </h2>
          <div className="flex gap-2" role="group" aria-label="View">
            <Link href={`${P}?set=${chosen.id}`} aria-current={!previewing ? "page" : undefined} className={`btn min-h-11 ${!previewing ? "btn-primary" : "btn-outline"}`}>Questions</Link>
            <Link href={`${P}?set=${chosen.id}&view=preview`} aria-current={previewing ? "page" : undefined} className={`btn min-h-11 ${previewing ? "btn-primary" : "btn-outline"}`}>Preview</Link>
          </div>
        </div>
        {!editable && <p className="mt-3 rounded-2xl bg-rio-mist p-3 font-semibold text-rio-navy">This version is {chosen.status} and cannot be changed. <span lang="ta" className="block font-medium">இந்தப் பதிப்பை மாற்ற முடியாது.</span></p>}

        {previewing ? (
          <div className="mt-4">
            {preview && preview.ok ? (
              <>
                <p className="mb-3 text-sm text-rio-slate">This is how parents in every competition will see the questions. {preview.data.inactiveCount > 0 && `${preview.data.inactiveCount} inactive question${preview.data.inactiveCount === 1 ? " is" : "s are"} hidden.`}</p>
                <QuestionPreview questions={preview.data.questions} />
              </>
            ) : <Banner kind="error" text={ERROR.unavailable!} />}
          </div>
        ) : (
          <>
            {questions.length === 0 ? (
              <p className="mt-4 text-rio-slate">This version has no questions yet. Add the first one below.<span lang="ta" className="block text-sm">இன்னும் கேள்விகள் இல்லை.</span></p>
            ) : (
              <ol className="mt-4 space-y-3">
                {questions.map((x, i) => <QuestionCard key={x.id} q={x} index={i} count={questions.length} slug={slug} setId={chosen.id} editable={editable} />)}
              </ol>
            )}
            {editable && (
              <div className="mt-5">
                <h3 className="font-semibold text-rio-navy">Add a question / கேள்வியைச் சேர்</h3>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {QUESTION_TYPES.map((t) => (
                    <li key={t}>
                      <Link href={`${P}?set=${chosen.id}&new=${t}`} className="btn btn-outline min-h-11 w-full justify-start text-left">
                        <Icon name="edit" className="h-4 w-4 shrink-0" /> {TYPE_LABEL[t].ta} / <span lang="en">{TYPE_LABEL[t].en}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {editable && (
        <div className="card mt-6 p-4 sm:p-6">
          <h2 className="font-display text-2xl font-bold text-rio-navy">Publish to all competitions <span lang="ta" className="font-medium">/ எல்லாப் போட்டிகளுக்கும் வெளியிடு</span></h2>
          {problems.length > 0 && (
            <ul className="mt-3 space-y-1 text-rio-error" role="alert">
              {problems.map((p, i) => { const m = PROBLEM_MESSAGE[p.code] ?? ERROR.other!; return <li key={i} className="font-semibold">{m.en} <span lang="ta" className="font-medium">{m.ta}</span></li>; })}
            </ul>
          )}
          <p className="mt-3 text-sm text-rio-slate">Nothing is published until you confirm. Registration stays closed either way.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <PublishPanel slug={slug} setId={chosen.id} version={chosen.version} activeCount={activeCount} inactiveCount={questions.length - activeCount} competitions={names} blocked={problems.length > 0} />
            </div>
            <details className="min-w-0">
              <summary className="btn btn-outline min-h-11 cursor-pointer list-none">Discard draft…</summary>
              <form action={discardDraftAction} className="mt-2 rounded-xl bg-rio-blush p-3">
                <input type="hidden" name="slug" value={slug} /><input type="hidden" name="setId" value={chosen.id} />
                <p className="text-sm font-semibold text-rio-navy">Delete this draft and all its questions? Published versions are not affected.</p>
                <button type="submit" className="btn btn-primary mt-2 min-h-11">Yes, discard</button>
              </form>
            </details>
          </div>
        </div>
      )}
      {usedBy}
    </>,
  );
}
