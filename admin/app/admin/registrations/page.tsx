import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RegistrationFilters } from "@/components/admin/registration-filters";
import { Icon } from "@/components/ui/icon";
import { RegistrationRowActions } from "@/components/admin/registration-row-actions";
import { RegistrationTabs } from "@/components/admin/registration-tabs";
import { loadCompetitions, loadRegistrations } from "@/lib/admin/api";
import { formatIst } from "@/lib/admin/format";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "பதிவுகள் · Registrations", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { draft: "Draft", held: "Held", finalized: "Finalized", withdrawn: "Withdrawn", rejected: "Rejected" };
const STATUS_TONE: Record<string, string> = {
  draft: "border-violet-200 bg-violet-50 text-violet-700",
  held: "border-amber-200 bg-amber-50 text-amber-700",
  finalized: "border-emerald-200 bg-emerald-50 text-emerald-700",
  withdrawn: "border-slate-200 bg-slate-100 text-slate-700",
  rejected: "border-rose-200 bg-rose-50 text-rio-rose",
};
type Search = { tab?: string; competition?: string; status?: string; q?: string; sort?: string; video?: string; duplicate?: string; page?: string; notice?: string };
const SORT: Record<string, string> = { newest: "Newest first / புதியவை முதலில்", oldest: "Oldest first / பழையவை முதலில்", updated: "Recently updated / சமீபத்தில் புதுப்பிக்கப்பட்டவை", child_asc: "Child name A–Z", child_desc: "Child name Z–A" };
const NOTICE: Record<string, string> = { updated: "Registration saved. / பதிவு சேமிக்கப்பட்டது.", deleted: "Draft registration deleted. / வரைவுப் பதிவு நீக்கப்பட்டது." };

export default async function AdminRegistrationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const raw = await searchParams;
  if (raw.tab === "deleted") redirect("/admin/registrations/deleted"); // the old address of the Deleted page
  const competition = raw.competition && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.competition) ? raw.competition : undefined;
  const status = raw.status && raw.status in STATUS ? raw.status : undefined;
  const search = raw.q?.trim().slice(0, 80) || undefined;
  const sort = raw.sort && raw.sort in SORT && raw.sort !== "newest" ? raw.sort : undefined;
  const video = raw.video === "uploaded" || raw.video === "none" ? raw.video : undefined;
  const duplicate = raw.duplicate === "1";
  const page = raw.page && /^[1-9][0-9]{0,5}$/.test(raw.page) ? Number(raw.page) : 1;
  const notice = raw.notice && raw.notice in NOTICE ? raw.notice : undefined;
  // The session check and the data load are independent round trips, so they run together; the page still renders only after the check passes.
  const [session, list, competitions] = await Promise.all([requireStaff("admin"), loadRegistrations({ competition, status, q: search, sort, video, duplicate, page }), loadCompetitions()]);
  const totalPages = list.ok ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const pageLink = (p: number) => {
    const q = new URLSearchParams();
    if (competition) q.set("competition", competition);
    if (status) q.set("status", status);
    if (search) q.set("q", search);
    if (sort) q.set("sort", sort);
    if (video) q.set("video", video);
    if (duplicate) q.set("duplicate", "1");
    if (p > 1) q.set("page", String(p));
    return `/admin/registrations${q.size > 0 ? `?${q}` : ""}`;
  };
  // After a delete the current page may no longer exist: go to the last one that does, keeping the filters and the notice.
  if (list.ok && list.data.total > 0 && page > totalPages) redirect(`${pageLink(totalPages)}${pageLink(totalPages).includes("?") ? "&" : "?"}notice=${notice ?? "deleted"}`);

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <p lang="en" className="eyebrow">
        <span aria-hidden="true" className="h-px w-8 bg-current" />
        Registration management
      </p>
      <h1 className="mt-2 text-[clamp(1.75rem,4vw,2rem)] font-bold leading-tight text-rio-navy">
        <span lang="ta" className="block">பதிவுகள்</span>
        <span lang="en" className="mt-0.5 block text-base font-medium leading-snug text-rio-slate sm:text-lg">Registrations</span>
      </h1>

      {notice && <p role="status" className="mt-4 rounded-2xl border border-rio-ok/30 bg-white px-4 py-3 text-sm font-semibold text-rio-ok">{NOTICE[notice]}</p>}

      <RegistrationTabs canSeeDeleted={session.role === "super_admin"} />

      <div className="card mt-6 bg-white/90 p-4 sm:p-5">
        <RegistrationFilters
          initial={{ q: search ?? "", competition: competition ?? "", status: status ?? "", sort: sort ?? "newest", video: video ?? "", dup: duplicate }}
          competitions={competitions.ok ? competitions.data : []}
          statuses={STATUS}
          sorts={SORT}
        />
      </div>

      {!list.ok && (
        <p role="alert" className="mt-6 flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-4 text-sm font-semibold leading-snug text-rio-error sm:p-5">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="min-w-0">
            The registrations could not be loaded{list.reason === "forbidden" ? ": your session cannot read them" : ". The server is not reachable"}. Nothing is shown rather than a guess. Reload to try again.
            <span lang="ta" className="mt-1 block font-medium leading-[1.5]">பதிவுகளை ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள்.</span>
          </span>
        </p>
      )}

      {list.ok && (
        <div className="card mt-6 overflow-hidden p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold leading-snug text-rio-navy">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rio-blush text-rio-rose"><Icon name="list" className="h-5 w-5" /></span>
              <span><span lang="ta" className="block">பதிவு பட்டியல்</span><span lang="en" className="block text-sm font-medium text-rio-slate">Registration list</span></span>
            </h2>
            <p role="status" className="text-sm font-medium text-rio-slate">
              {list.data.total === 0 ? "No registrations match." : `${list.data.total.toLocaleString("en-IN")} registration${list.data.total === 1 ? "" : "s"}. Page ${list.data.page} of ${totalPages}.`}
            </p>
          </div>

          {list.data.total === 0 ? (
            <p className="mt-4 rounded-xl bg-rio-mist px-4 py-3 text-sm leading-snug text-rio-slate">No registrations match the selected filters.</p>
          ) : (
            <div className="mt-4 -mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
              <table className="min-w-[1040px] w-full border-separate border-spacing-0 text-left text-[0.8125rem] text-rio-ink">
                <thead className="bg-rio-blush text-xs uppercase tracking-wide text-rio-navy">
                  <tr>
                    <th scope="col" className="w-[11rem] whitespace-nowrap rounded-l-xl px-3 py-2.5 font-bold">Registration ID<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">பதிவு குறியீடு</span></th>
                    <th scope="col" className="w-[21%] px-3 py-2.5 font-bold">Participant<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">பங்கேற்பாளர்</span></th>
                    <th scope="col" className="w-[15%] px-3 py-2.5 font-bold">Competition<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">போட்டி</span></th>
                    <th scope="col" className="w-[8rem] px-3 py-2.5 font-bold">Status<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">நிலை</span></th>
                    <th scope="col" className="w-[10rem] px-3 py-2.5 font-bold">Video<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">வீடியோ</span></th>
                    <th scope="col" className="w-[11rem] whitespace-nowrap px-3 py-2.5 font-bold">Updated at<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">புதுப்பிக்கப்பட்ட நேரம்</span></th>
                    <th scope="col" className="w-[5rem] rounded-r-xl px-3 py-2.5 text-right font-bold">Actions<span lang="ta" className="mt-0.5 block text-[0.65rem] font-medium normal-case tracking-normal">செயல்கள்</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rio-navy/10">
                  {list.data.registrations.map((r) => (
                    <tr key={r.entryCode} className="transition-colors hover:bg-rio-blush/35">
                      <td className="px-3 py-2.5 align-middle">
                        <Link href={`/admin/registrations/${r.entryCode}`} className="inline-flex items-center gap-2 whitespace-nowrap font-mono text-[0.8125rem] font-bold text-rio-navy hover:text-rio-rose">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rio-blush text-rio-rose"><Icon name="clipboard" className="h-3.5 w-3.5" /></span>
                          {r.entryCode}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className="block font-semibold leading-snug text-rio-navy [overflow-wrap:anywhere]">{r.childName}, {r.childAge}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-rio-slate [overflow-wrap:anywhere]">Guardian: {r.guardianName}</span>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className="block font-semibold leading-snug text-rio-navy">{r.competitionNameEn}</span>
                        <span lang="ta" className="block text-xs leading-snug text-rio-slate [overflow-wrap:anywhere]">{r.competitionNameTa}</span>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.6875rem] font-bold ${STATUS_TONE[r.status] ?? "border-rio-navy/15 bg-rio-mist text-rio-navy"}`}>{STATUS[r.status] ?? r.status}</span>
                        {r.openDuplicateFlag && <span className="mt-1 block text-xs font-semibold text-rio-rose">Possible duplicate</span>}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        {r.hasVideo !== undefined && (
                          <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.6875rem] font-bold ${r.hasVideo ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-rio-slate"}`}>
                            <Icon name="video" className="h-3 w-3 shrink-0" />
                            {r.hasVideo ? <span>Uploaded <span lang="ta" className="font-medium">/ உள்ளது</span></span> : <span>No video <span lang="ta" className="font-medium">/ இல்லை</span></span>}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-middle text-xs font-medium text-rio-slate"><span className="inline-flex items-center gap-1.5"><Icon name="calendar" className="h-3.5 w-3.5 shrink-0 text-rio-navy" />{formatIst(r.updatedAt)}</span></td>
                      <td className="px-3 py-2.5 text-right align-middle"><RegistrationRowActions registration={r} canDelete={session.role === "super_admin"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {list.data.total > 0 && (
            <nav aria-label="Registration pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rio-navy/10 pt-4">
              {list.data.page > 1 ? <Link href={pageLink(list.data.page - 1)} className="btn btn-outline min-h-11 !px-4 text-sm">← Previous <span lang="ta" className="font-medium">/ முந்தைய</span></Link> : <span className="btn min-h-11 cursor-not-allowed !px-4 text-sm text-rio-slate/50">← Previous <span lang="ta" className="font-medium">/ முந்தைய</span></span>}
              <div className="flex items-center gap-1.5">
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => pageNumber === list.data.page ? (
                  <span key={pageNumber} aria-current="page" className="inline-flex h-10 min-w-10 items-center justify-center rounded-xl bg-rio-rose px-3 text-sm font-bold text-white">{pageNumber}</span>
                ) : (
                  <Link key={pageNumber} href={pageLink(pageNumber)} className="inline-flex h-10 min-w-10 items-center justify-center rounded-xl border border-rio-navy/15 bg-white px-3 text-sm font-bold text-rio-navy hover:border-rio-rose/40 hover:bg-rio-blush">{pageNumber}</Link>
                ))}
              </div>
              {list.data.page < totalPages ? <Link href={pageLink(list.data.page + 1)} className="btn btn-primary min-h-11 !px-4 text-sm">Next <span lang="ta" className="font-medium">/ அடுத்து</span> →</Link> : <span className="btn min-h-11 cursor-not-allowed !px-4 text-sm text-rio-slate/50">Next <span lang="ta" className="font-medium">/ அடுத்து</span> →</span>}
            </nav>
          )}
        </div>
      )}
    </section>
  );
}
