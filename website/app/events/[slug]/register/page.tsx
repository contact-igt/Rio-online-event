import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bilingual } from "@/components/auth/bilingual";
import { DetailsSummary } from "@/components/registration/details-summary";
import { RegistrationForm } from "@/components/registration/registration-form";
import { SubmittedPanel } from "@/components/registration/submitted-panel";
import { Icon, eventIcon } from "@/components/ui/icon";
import { getEvent, rules } from "@/lib/events";
import { consentActivationState, getConsentCopy } from "@/lib/registration/consent";
import { currentRegistration, publicEvents, publicSettings, type PublicEvent } from "@/lib/registration/express";
import { reg } from "@/lib/registration/messages";

export const metadata: Metadata = { title: "பதிவு · Registration", robots: { index: false } };

function unavailable(slug: string, label = "This competition is not available right now.") {
  return (
    <div className="wash min-h-screen">
      <section className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6 text-center">
        <Link href="/competitions" className="inline-flex min-h-11 items-center font-semibold text-rio-rose underline">
          ← Back to Competitions / போட்டிகள்
        </Link>
        <p role="alert" className="mt-8 rounded-2xl bg-rio-blush p-6 font-semibold text-rio-error">
          {label}
          <span lang="ta" className="block mt-1 font-medium">இந்தப் போட்டி தற்போது கிடைக்கவில்லை.</span>
        </p>
        <Link href={`/events/${slug}`} className="mt-4 inline-flex min-h-11 items-center font-semibold text-rio-rose underline">
          Back to competition / போட்டி விவரம்
        </Link>
      </section>
    </div>
  );
}

function eventFor(slug: string, remote: PublicEvent) {
  const local = getEvent(slug);
  if (!local) return null;
  return { ...local, nameTa: remote.nameTa, nameEn: remote.nameEn, minAge: remote.minAge, maxAge: remote.maxAge };
}

export default async function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const local = getEvent(slug);
  if (!local) notFound();

  const [events, settings, current] = await Promise.all([publicEvents(), publicSettings(), currentRegistration()]);
  const remote = events?.find((item) => item.slug === slug);
  if (!remote) return unavailable(slug, events ? "This competition has not been configured yet." : "Registration is temporarily unavailable.");
  const event = eventFor(slug, remote)!;

  const view = current?.view && current.view.event.slug === slug ? current.view : null;
  const elsewhere = current?.view && !view ? current.view : null;
  const questionSet = view ? view.questionSet : remote.questionSet;
  const open = Boolean(settings?.registrationOpen && questionSet);
  const consentUnavailable =
    settings?.guardianConsentVersion !== null &&
    settings?.guardianConsentVersion !== undefined &&
    consentActivationState(settings.guardianConsentVersion) === "unavailable";
  const consent = !consentUnavailable && settings?.guardianConsentVersion ? getConsentCopy(settings.guardianConsentVersion) : null;
  // One page, one button (owner, 2026-11-13): the details, the video and the consent box, then Submit saves, uploads and submits. A draft
  // left unfinished (the connection dropped, say) opens the same form, filled in, with its video if it has one. Once submitted, the summary
  // only. Finalized and held look the same to the parent.
  const submitted = view?.status === "finalized" || view?.status === "held";
  const formShown = Boolean(open && consent && questionSet && (!view || view.editable));

  const draft = view
    ? {
        id: "current",
        childName: view.child.name,
        childAge: view.child.age,
        parentName: view.guardian.name,
        mobileLocal: view.guardian.mobile.replace(/\D/g, "").slice(-10),
        mediaConsent: view.consent.media.granted === true,
        email: view.guardian.email ?? "",
        answers: view.answers,
      }
    : null;

  return (
    <div className="wash min-h-screen pb-16">
      <section className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        {/* Navigation Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm font-semibold text-rio-navy">
          <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 underline underline-offset-4 text-rio-slate hover:text-rio-navy">
            <Icon name="chevron" className="h-3.5 w-3.5 rotate-180" />
            Home
          </Link>
          <span aria-hidden="true" className="text-slate-300">/</span>
          <Link href="/competitions" className="inline-flex min-h-11 items-center underline underline-offset-4 text-rio-slate hover:text-rio-navy">
            Competitions
          </Link>
          <span aria-hidden="true" className="text-slate-300">/</span>
          <span className="text-rio-navy font-bold">{event.nameEn}</span>
        </nav>

        {/* Competition Header Card (Single Centered Column) */}
        <div className="mt-5 rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-rio-blush text-rio-rose shadow-2xs">
              <Icon name={eventIcon[event.slug] ?? "star"} className="h-7 w-7" />
            </span>
            <div className="min-w-0">
              <span className="inline-block rounded-full bg-rio-mist px-3 py-0.5 text-xs font-bold text-rio-navy">
                Children&apos;s Day 2026
              </span>
              <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold text-rio-navy leading-tight">
                {event.nameTa} <span lang="en" className="block sm:inline font-sans text-lg sm:text-2xl font-semibold text-rio-slate sm:ml-1">/ {event.nameEn}</span>
              </h1>
            </div>
          </div>

          {/* Clean 3-chip quick facts */}
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4 text-center">
            <div className="rounded-xl bg-slate-50 p-2">
              <span className="block text-[11px] font-semibold text-rio-slate">Age / வயது</span>
              <strong className="text-xs sm:text-sm font-bold text-rio-navy">{event.minAge} – {event.maxAge} yrs</strong>
            </div>
            <div className="rounded-xl bg-slate-50 p-2">
              <span className="block text-[11px] font-semibold text-rio-slate">Video / வீடியோ</span>
              <strong className="text-xs sm:text-sm font-bold text-rio-navy">{rules.videoSeconds.min}–{rules.videoSeconds.max}s</strong>
            </div>
            <div className="rounded-xl bg-slate-50 p-2">
              <span className="block text-[11px] font-semibold text-rio-slate">Mode / முறை</span>
              <strong className="text-xs sm:text-sm font-bold text-rio-navy">Online</strong>
            </div>
          </div>
        </div>

        {/* Alerts & Messages */}
        <div className="mt-6 space-y-6">
          {consentUnavailable && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
              <h2 className="text-lg font-bold">Registration is temporarily unavailable.</h2>
              <p className="mt-1 text-sm">The required guardian-consent wording is not available yet. Please try again later.</p>
            </div>
          )}

          {!open && !consentUnavailable && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
              <h2 className="text-xl font-bold text-rio-navy">{reg.closed.title.ta}</h2>
              <p className="mt-1 text-rio-slate text-sm font-semibold">{reg.closed.title.en}</p>
              <p className="mt-3 text-sm text-rio-navy">
                <Bilingual m={reg.closed.body} />
              </p>
            </div>
          )}

          {elsewhere && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-900">
              <p className="font-semibold">
                You have an existing registration for {elsewhere.event.nameEn} ({elsewhere.event.nameTa}).
              </p>
              <Link href={`/events/${elsewhere.event.slug}/register`} className="mt-2 inline-flex items-center font-bold text-rio-rose underline">
                View that registration →
              </Link>
            </div>
          )}

          {submitted && view && (
            // The success page (owner, 2026-11-13: "You have been registered successfully"). No e-mail is promised: none is sent yet.
            <SubmittedPanel
              focus
              childName={view.child.name}
              childAge={view.child.age}
              eventNameTa={event.nameTa}
              eventNameEn={event.nameEn}
              submittedAt={view.updatedAt}
              mediaConsent={view.consent.media.granted === true}
              emailMasked={null}
              reference={view.reference}
            />
          )}

          {view && !formShown && <DetailsSummary view={view} editHref={null} />}

          {formShown && consent && questionSet && (
            <div id="details" className="mt-6 scroll-mt-4">
              {/* The same key before and after the first save: saving sets the registration cookie, the page re-renders with the new draft,
                  and the form must keep the chosen video and carry on to the upload instead of starting over. */}
              <RegistrationForm
                key="entry"
                event={{ slug: event.slug, minAge: event.minAge, maxAge: event.maxAge }}
                questions={questionSet.questions}
                consent={{ version: consent.version, notice: consent.notice, guardian: consent.guardian, media: consent.media }}
                draft={draft}
                finish={{ hasVideo: view?.video?.uploaded === true, uploadsOpen: settings?.videoUploads === true }}
              />
            </div>
          )}

          {!view && remote.questionSet === null && (
            <p className="rounded-2xl bg-white border border-slate-200 p-5 text-center text-rio-slate shadow-xs">
              Questions are not published for this competition yet. / இந்தப் போட்டிக்கான கேள்விகள் இன்னும் வெளியிடப்படவில்லை.
            </p>
          )}

          <div className="text-center pt-2">
            <Link href={`/events/${event.slug}`} className="inline-flex min-h-11 items-center font-semibold text-rio-rose hover:underline text-sm">
              ← Back to {event.nameTa} ({event.nameEn})
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
