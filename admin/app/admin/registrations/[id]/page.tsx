import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { loadRegistration } from "@/lib/admin/api";
import { formatIst } from "@/lib/admin/format";
import { requireStaff } from "@/lib/staff/auth";

export const metadata = { title: "Registration · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { draft: "Draft", held: "Held", finalized: "Finalized", withdrawn: "Withdrawn", rejected: "Rejected" };
const VIDEO_TYPE: Record<string, string> = { "video/mp4": "MP4", "video/quicktime": "MOV", "video/webm": "WebM" };
const REASON: Record<string, string> = { same_child_mobile_event: "Same child name and mobile number in this competition", similar_name: "Similar name", manual: "Flagged by hand" };

function Row({ label, ta, children }: { label: string; ta?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-4 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <dt className="text-rio-slate">{label}{ta && <span lang="ta" className="block text-sm">{ta}</span>}</dt>
      <dd className="min-w-0 font-semibold text-rio-navy [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

// One entry from GET /admin/registrations/:entryCode (the route parameter is the entry code). Opening it is written to the audit log by the API.
// Answers are shown against the question version the entry was created with.
export default async function AdminRegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff("admin");
  const { id: entryCode } = await params;
  if (!/^[A-Z0-9]{6,16}$/.test(entryCode)) notFound();
  const loaded = await loadRegistration(entryCode);
  if (!loaded.ok && loaded.reason === "not_found") notFound();

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6 lg:px-8">
      <Link href="/admin/registrations" className="inline-flex min-h-11 items-center font-semibold text-rio-rose underline underline-offset-4">← Registrations</Link>
      {!loaded.ok ? (
        <p role="alert" className="mt-4 flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-3 font-semibold text-rio-error">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            This registration could not be loaded{loaded.reason === "forbidden" ? ": your session cannot read it" : ". The server is not reachable"}. Reload to try again.
            <span lang="ta" className="mt-1 block font-medium">பதிவை ஏற்ற முடியவில்லை.</span>
          </span>
        </p>
      ) : (
        <>
          <h1 className="mt-2 text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold">
            <span className="font-mono">{loaded.data.entryCode}</span>
            <span className="block text-[0.6em] font-bold text-rio-slate">{loaded.data.competition.nameEn} / <span lang="ta">{loaded.data.competition.nameTa}</span></span>
          </h1>
          <p className="mt-3 rounded-2xl bg-rio-mist p-3 text-sm">Opening this page is recorded in the audit log. Contact details are for running the competition only.</p>

          <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
            <div className="card min-w-0 p-4 sm:p-6">
              <h2 className="font-display text-2xl font-bold text-rio-navy">Entry <span lang="ta" className="font-medium">/ பதிவு</span></h2>
              <dl className="mt-2 divide-y divide-rio-navy/10">
                <Row label="Status" ta="நிலை">{STATUS[loaded.data.status] ?? loaded.data.status}</Row>
                <Row label="Child" ta="குழந்தை">{loaded.data.child.name}, age {loaded.data.child.age}</Row>
                <Row label="Guardian" ta="பாதுகாவலர்">{loaded.data.guardian.name}</Row>
                <Row label="Mobile" ta="கைப்பேசி">{loaded.data.guardian.mobile}</Row>
                <Row label="Email" ta="மின்னஞ்சல்">{loaded.data.guardian.email ?? "Not given"}</Row>
                <Row label="Guardian consent">{loaded.data.consent.guardian.version ? `${loaded.data.consent.guardian.version}, ${formatIst(loaded.data.consent.guardian.at)}` : "Not recorded"}</Row>
                <Row label="Media consent">
                  {loaded.data.consent.media.granted === null ? "Not asked" : `${loaded.data.consent.media.granted ? "Granted" : "Declined"} (${loaded.data.consent.media.version}), ${formatIst(loaded.data.consent.media.at)}`}
                </Row>
                {loaded.data.video && (
                  <Row label="Video" ta="வீடியோ">
                    {loaded.data.video.uploaded
                      ? `Uploaded · ${((loaded.data.video.bytes ?? 0) / (1024 * 1024)).toFixed(1)} MB · ${VIDEO_TYPE[loaded.data.video.contentType ?? ""] ?? "video"} · ${formatIst(loaded.data.video.uploadedAt)}`
                      : "Not uploaded yet"}
                  </Row>
                )}
                <Row label="Question version">v{loaded.data.questionSetVersion}</Row>
                <Row label="Created">{formatIst(loaded.data.createdAt)}</Row>
                <Row label="Updated">{formatIst(loaded.data.updatedAt)}</Row>
              </dl>
              {loaded.data.duplicates.length > 0 && (
                <div className="mt-4 rounded-2xl border border-rio-pink/50 bg-rio-blush p-3">
                  <h3 className="font-bold text-rio-navy">Possible duplicate</h3>
                  <ul className="mt-1 text-sm">
                    {loaded.data.duplicates.map((d, i) => (
                      <li key={i}>
                        {REASON[d.reason] ?? d.reason} ({d.status}){d.matchedEntryCode && <>: <Link href={`/admin/registrations/${d.matchedEntryCode}`} className="font-mono font-semibold text-rio-rose underline">{d.matchedEntryCode}</Link></>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="card min-w-0 p-4 sm:p-6">
              <h2 className="font-display text-2xl font-bold text-rio-navy">Answers <span lang="ta" className="font-medium">/ பதில்கள்</span></h2>
              {loaded.data.answers.length === 0 && <p className="mt-2 text-rio-slate">This competition has no questions.</p>}
              <dl className="mt-2 divide-y divide-rio-navy/10">
                {loaded.data.answers.map((a) => (
                  <Row key={a.key} label={a.promptEn} ta={a.promptTa}>
                    {a.value === null ? (
                      <span className="font-medium text-rio-slate">{a.required ? "Not answered (required)" : "Not answered"}</span>
                    ) : a.chosen ? (
                      a.chosen.map((c) => `${c.en} / ${c.ta}`).join("; ")
                    ) : (
                      <span className="whitespace-pre-wrap">{String(a.value)}</span>
                    )}
                  </Row>
                ))}
              </dl>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
