import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Bilingual } from "@/components/auth/bilingual";
import { EventSummary } from "@/components/registration/event-summary";
import { ProgressSteps } from "@/components/registration/progress-steps";
import { RecoveryForm } from "@/components/registration/recovery-form";
import { RegistrationForm } from "@/components/registration/registration-form";
import { Icon } from "@/components/ui/icon";
import { getEvent } from "@/lib/events";
import { consentActivationState, getConsentCopy } from "@/lib/registration/consent";
import { currentRegistration, publicEvents, publicSettings, type PublicEvent } from "@/lib/registration/express";
import { reg } from "@/lib/registration/messages";

export const metadata: Metadata = { title: "பதிவு · Registration", robots: { index: false } };

function unavailable(slug: string, label = "This competition is not available right now.") {
  return <div className="wash"><section className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-6 lg:px-8"><Link href="/competitions" className="inline-flex min-h-11 items-center font-semibold text-rio-rose underline">Competitions</Link><p role="alert" className="mt-8 rounded-2xl bg-rio-blush p-5 font-semibold text-rio-error">{label}<span lang="ta" className="block">இந்தப் போட்டி தற்போது கிடைக்கவில்லை.</span></p><Link href={`/events/${slug}`} className="mt-4 inline-flex min-h-11 items-center font-semibold text-rio-rose underline">Back to competition</Link></section></div>;
}

function eventFor(slug: string, remote: PublicEvent) {
  const local = getEvent(slug);
  if (!local) return null;
  return { ...local, nameTa: remote.nameTa, nameEn: remote.nameEn, minAge: remote.minAge, maxAge: remote.maxAge };
}

export default async function RegisterPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { slug } = await params;
  const local = getEvent(slug);
  if (!local) notFound();
  const [events, settings, current] = await Promise.all([publicEvents(), publicSettings(), currentRegistration()]);
  const remote = events?.find((item) => item.slug === slug);
  if (!remote) return unavailable(slug, events ? "This competition has not been configured yet." : "Registration is temporarily unavailable.");
  const event = eventFor(slug, remote)!;
  // A saved draft belongs to one competition. On another competition's page it is only offered as a link; this page's form never edits it.
  const view = current?.view && current.view.event.slug === slug ? current.view : null;
  const elsewhere = current?.view && !view ? current.view : null;
  // An existing draft keeps the question version it was created with; only a new entry gets the set published now.
  const questionSet = view ? view.questionSet : remote.questionSet;
  const open = Boolean(settings?.registrationOpen && questionSet);
  const consentUnavailable = settings?.guardianConsentVersion !== null && settings?.guardianConsentVersion !== undefined && consentActivationState(settings.guardianConsentVersion) === "unavailable";
  const consent = !consentUnavailable && settings?.guardianConsentVersion ? getConsentCopy(settings.guardianConsentVersion) : null;
  const editable = view?.editable === true;
  const query = await searchParams;
  const recoveryNotice = (await cookies()).get("rio_recovery_notice")?.value ?? null;
  const draft = view
    ? { id: "current", childName: view.child.name, childAge: view.child.age, parentName: view.guardian.name, mobileLocal: view.guardian.mobile.replace(/\D/g, "").slice(-10), mediaConsent: view.consent.media.granted === true, email: view.guardian.email ?? "", answers: view.answers }
    : null;

  return (
    <div className="wash">
      <section className="mx-auto w-full max-w-[1200px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-rio-navy">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 underline underline-offset-4"><Icon name="chevron" className="h-4 w-4 rotate-180" /><span lang="en">Home</span></Link><span aria-hidden="true">/</span><Link href="/competitions" className="inline-flex min-h-11 items-center underline underline-offset-4">Competitions</Link>
        </nav>
        <p lang="en" className="eyebrow mt-1"><span aria-hidden="true" className="h-px w-8 bg-current" />Children&apos;s Day Celebration 2026</p>
        <h1 className="mt-2 text-[clamp(1.9rem,6vw,3.25rem)] font-extrabold [overflow-wrap:anywhere]">{event.nameTa} <span lang="en">/ {event.nameEn}</span></h1>
        {(open || view) && <div className="mt-6"><ProgressSteps stage={view && (view.status === "draft" || view.status === "uploaded" || view.status === "finalized") ? view.status : "none"} /></div>}
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
          <EventSummary event={event} />
          <div className="min-w-0 space-y-6">
            {query.saved === "1" && recoveryNotice && <div role="status" className="rounded-2xl border-2 border-rio-ok bg-white p-4"><p className="font-display text-xl font-bold text-rio-ok">வரைவு சேமிக்கப்பட்டது <span lang="en" className="font-medium">/ Draft saved</span></p><p className="mt-2">Keep this recovery code safe. It is the only way to reopen this draft.</p><p className="mt-3 rounded-xl bg-rio-mist p-3 font-mono text-lg font-bold tracking-widest text-rio-navy" aria-label="Recovery code">{recoveryNotice}</p></div>}
            {consentUnavailable && <div className="card-soft p-5"><h2 className="text-2xl font-bold">Registration is temporarily unavailable.<span lang="ta" className="block text-rio-slate">பதிவு தற்காலிகமாக கிடைக்கவில்லை.</span></h2><p className="mt-2">The required guardian-consent wording is not available yet. Please try again later.</p></div>}
            {!open && !consentUnavailable && <div className="card-soft p-5"><h2 className="text-2xl font-bold">{reg.closed.title.ta}<span lang="en" className="block text-rio-slate">{reg.closed.title.en}</span></h2><p className="mt-2"><Bilingual m={reg.closed.body} /></p></div>}
            {elsewhere && <div className="card-soft p-5"><p className="font-semibold text-rio-navy">You have a saved draft for another competition: {elsewhere.event.nameEn}.<span lang="ta" className="block">வேறு போட்டிக்கான வரைவு உங்களிடம் உள்ளது: {elsewhere.event.nameTa}.</span></p><Link href={`/events/${elsewhere.event.slug}/register`} className="mt-2 inline-flex min-h-11 items-center font-semibold text-rio-rose underline underline-offset-4">Open that draft / அந்த வரைவைத் திற</Link></div>}
            {!view && <RecoveryForm event={event.slug} />}
            {open && consent && questionSet && (!view || editable) &&<div className="card p-5 sm:p-7"><div className="flex items-start gap-4"><span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-2xl bg-rio-blush text-rio-rose"><Icon name="edit" className="h-7 w-7" /></span><div><h2 className="text-2xl font-bold">{(view ? reg.form.editTitle : reg.title).ta} <span lang="en">/ {(view ? reg.form.editTitle : reg.title).en}</span></h2><p className="text-rio-slate"><Bilingual m={reg.form.intro} /></p></div></div><div className="mt-5"><RegistrationForm key={view?.reference ?? "new"} event={{ slug: event.slug, minAge: event.minAge, maxAge: event.maxAge }} questions={questionSet.questions} consent={{ version: consent.version, notice: consent.notice, guardian: consent.guardian, media: consent.media }} draft={draft} /></div></div>}
            {view && !editable && <p className="font-semibold text-rio-navy">This draft can no longer be edited. / இந்த வரைவை இனி திருத்த முடியாது.</p>}
            {view && <section className="card p-4 sm:p-6"><h2 className="text-xl font-bold">Next steps / அடுத்த படிகள்</h2><p className="mt-2 text-rio-slate">Video upload and final submission will be available in a later stage. / வீடியோ பதிவேற்றமும் இறுதி சமர்ப்பிப்பும் அடுத்த கட்டத்தில் கிடைக்கும்.</p></section>}
            {!view && remote.questionSet === null && <p className="rounded-2xl bg-rio-mist p-4 text-rio-slate">Questions are not published for this competition yet. / இந்தப் போட்டிக்கான கேள்விகள் இன்னும் வெளியிடப்படவில்லை.</p>}
            <Link href={`/events/${event.slug}`} className="inline-flex min-h-11 items-center font-semibold text-rio-rose underline underline-offset-4">← {event.nameTa}</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
