import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RegistrationTabs } from "@/components/admin/registration-tabs";
import { DeletedRegistrationActions } from "@/components/admin/registration-row-actions";
import { Icon } from "@/components/ui/icon";
import { loadDeletedRegistrations, type DeletedRegistrationList, type Loaded } from "@/lib/admin/api";
import { formatIst } from "@/lib/admin/format";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "நீக்கிய பதிவுகள் · Deleted registrations", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { draft: "Draft", held: "Held", finalized: "Finalized", withdrawn: "Withdrawn", rejected: "Rejected" };
const STATUS_TONE: Record<string, string> = {
  draft: "border-violet-200 bg-violet-50 text-violet-700",
  held: "border-amber-200 bg-amber-50 text-amber-700",
  finalized: "border-emerald-200 bg-emerald-50 text-emerald-700",
  withdrawn: "border-slate-200 bg-slate-100 text-slate-700",
  rejected: "border-rose-200 bg-rose-50 text-rio-rose",
};

function DeletedRegistrationsPanel({ list, search, pageLink }: { list: Loaded<DeletedRegistrationList>; search?: string; pageLink: (page: number) => string }) {
  if (!list.ok) return <p role="alert" className="mt-6 rounded-2xl border border-rio-error/40 bg-white p-4 text-sm font-semibold text-rio-error">Deleted registrations could not be loaded. Reload to try again.</p>;
  const totalPages = Math.max(1, Math.ceil(list.data.total / list.data.pageSize));
  return (
    <div className="card mt-6 overflow-hidden p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2.5 text-lg font-semibold leading-snug text-rio-navy"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rio-blush text-rio-rose"><Icon name="trash" className="h-5 w-5" /></span><span><span lang="ta" className="block">நீக்கப்பட்ட பதிவுகள்</span><span className="block text-sm font-medium text-rio-slate">Deleted registrations</span></span></h2>
          <p className="mt-1 text-sm text-rio-slate">Super Admin access only. Deleted drafts remain preserved for history.</p>
        </div>
        <p role="status" className="text-sm font-medium text-rio-slate">{list.data.total.toLocaleString("en-IN")} deleted registration{list.data.total === 1 ? "" : "s"}. Page {list.data.page} of {totalPages}.</p>
      </div>
      <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
        <label htmlFor="deleted-q" className="min-w-[16rem] flex-1 text-xs font-semibold text-rio-navy">Search deleted registrations<input id="deleted-q" name="q" type="search" defaultValue={search ?? ""} maxLength={80} placeholder="Reference, child or guardian" className="field mt-1 h-11 min-h-11 text-sm" /></label>
        <button type="submit" className="btn btn-primary h-11 min-h-11 !px-5 text-sm"><Icon name="filter" className="h-4 w-4" />Search</button>
      </form>
      {list.data.total === 0 ? <p className="mt-4 rounded-xl bg-rio-mist px-4 py-3 text-sm text-rio-slate">No deleted registrations found.</p> : (
        <div className="mt-4 -mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="min-w-[900px] w-full border-separate border-spacing-0 text-left text-[0.8125rem] text-rio-ink">
            <thead className="bg-rio-blush text-xs uppercase tracking-wide text-rio-navy"><tr><th className="rounded-l-xl px-3 py-2.5 font-bold">Registration</th><th className="px-3 py-2.5 font-bold">Child / guardian</th><th className="px-3 py-2.5 font-bold">Competition</th><th className="px-3 py-2.5 font-bold">Previous status</th><th className="px-3 py-2.5 font-bold">Deleted at</th><th className="px-3 py-2.5 font-bold">Deleted by</th><th className="rounded-r-xl px-3 py-2.5 text-right font-bold">Actions</th></tr></thead>
            <tbody className="divide-y divide-rio-navy/10">{list.data.registrations.map((r) => <tr key={r.entryCode} className="hover:bg-rio-blush/35">
              <td className="px-3 py-3 align-middle"><span className="font-mono font-bold text-rio-navy">{r.entryCode}</span></td>
              <td className="px-3 py-3 align-middle"><span className="block font-semibold text-rio-navy">{r.childName}, {r.childAge}</span><span className="block text-xs text-rio-slate">Guardian: {r.guardianName}</span></td>
              <td className="px-3 py-3 align-middle"><span className="block font-semibold text-rio-navy">{r.competitionNameEn}</span><span lang="ta" className="block text-xs text-rio-slate">{r.competitionNameTa}</span></td>
              <td className="px-3 py-3 align-middle"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[0.6875rem] font-bold ${STATUS_TONE[r.status] ?? "border-rio-navy/15 bg-rio-mist text-rio-navy"}`}>{STATUS[r.status] ?? r.status}</span></td>
              <td className="whitespace-nowrap px-3 py-3 align-middle text-xs text-rio-slate">{formatIst(r.deletedAt)}</td>
              <td className="px-3 py-3 align-middle text-xs text-rio-slate">{r.deletedBy ?? "Not recorded"}</td>
              <td className="px-3 py-3 text-right align-middle"><DeletedRegistrationActions registration={r} /></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {list.data.total > 0 && <nav aria-label="Deleted registration pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rio-navy/10 pt-4">{list.data.page > 1 ? <Link href={pageLink(list.data.page - 1)} className="btn btn-outline min-h-11 !px-4 text-sm">← Previous</Link> : <span className="btn min-h-11 cursor-not-allowed !px-4 text-sm text-rio-slate/50">← Previous</span>}<span className="text-sm font-bold text-rio-navy">Page {list.data.page} of {totalPages}</span>{list.data.page < totalPages ? <Link href={pageLink(list.data.page + 1)} className="btn btn-primary min-h-11 !px-4 text-sm">Next →</Link> : <span className="btn min-h-11 cursor-not-allowed !px-4 text-sm text-rio-slate/50">Next →</span>}</nav>}
    </div>
  );
}

// Super Admin only: requireStaff answers anyone else with the same 404 as an unknown page, and the API checks the role again.
export default async function AdminDeletedRegistrationsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const raw = await searchParams;
  const search = raw.q?.trim().slice(0, 80) || undefined;
  const page = raw.page && /^[1-9][0-9]{0,5}$/.test(raw.page) ? Number(raw.page) : 1;
  const [, list] = await Promise.all([requireStaff("super_admin"), loadDeletedRegistrations({ q: search, page })]);
  const totalPages = list.ok ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const pageLink = (p: number) => {
    const q = new URLSearchParams();
    if (search) q.set("q", search);
    if (p > 1) q.set("page", String(p));
    return `/admin/registrations/deleted${q.size > 0 ? `?${q}` : ""}`;
  };

  // After the last row of the last page is deleted for good, go to the last page that still exists.
  if (list.ok && list.data.total > 0 && page > totalPages) redirect(pageLink(totalPages));

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

      <RegistrationTabs canSeeDeleted />
      <DeletedRegistrationsPanel list={list} search={search} pageLink={pageLink} />
    </section>
  );
}
