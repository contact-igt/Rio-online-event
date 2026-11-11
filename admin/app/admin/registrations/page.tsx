import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { loadCompetitions, loadRegistrations } from "@/lib/admin/api";
import { formatIst } from "@/lib/admin/format";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "பதிவுகள் · Registrations", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { draft: "Draft", held: "Held", finalized: "Finalized", withdrawn: "Withdrawn", rejected: "Rejected" };
type Search = { competition?: string; status?: string; page?: string };

// The list comes from GET /admin/registrations (MariaDB through the Express API). Filters are re-checked here only to build the link; the API validates them again.
export default async function AdminRegistrationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireStaff("admin");
  const raw = await searchParams;
  const competition = raw.competition && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.competition) ? raw.competition : undefined;
  const status = raw.status && raw.status in STATUS ? raw.status : undefined;
  const page = raw.page && /^[1-9][0-9]{0,5}$/.test(raw.page) ? Number(raw.page) : 1;
  const [list, competitions] = await Promise.all([loadRegistrations({ competition, status, page }), loadCompetitions()]);
  const pageLink = (p: number) => {
    const q = new URLSearchParams();
    if (competition) q.set("competition", competition);
    if (status) q.set("status", status);
    if (p > 1) q.set("page", String(p));
    return `/admin/registrations${q.size > 0 ? `?${q}` : ""}`;
  };

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6 lg:px-8">
      <h1 className="text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold">
        Registrations
        <span lang="ta" className="block text-[0.6em] font-bold text-rio-slate">பதிவுகள்</span>
      </h1>

      <form method="get" className="card mt-6 grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto] sm:items-end">
        <div>
          <label htmlFor="competition" className="block font-semibold text-rio-navy">Competition <span lang="ta" className="font-medium">/ போட்டி</span></label>
          <select id="competition" name="competition" defaultValue={competition ?? ""} className="field mt-1">
            <option value="">All competitions</option>
            {(competitions.ok ? competitions.data : []).map((c) => <option key={c.slug} value={c.slug}>{c.nameEn} / {c.nameTa}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="block font-semibold text-rio-navy">Status <span lang="ta" className="font-medium">/ நிலை</span></label>
          <select id="status" name="status" defaultValue={status ?? ""} className="field mt-1">
            <option value="">Any status</option>
            {Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-primary w-full sm:w-auto">Filter</button>
      </form>

      {!list.ok && (
        <p role="alert" className="mt-6 flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-3 font-semibold text-rio-error">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            The registrations could not be loaded{list.reason === "forbidden" ? ": your session cannot read them" : ". The server is not reachable"}. Nothing is shown rather than a guess. Reload to try again.
            <span lang="ta" className="mt-1 block font-medium">பதிவுகளை ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள்.</span>
          </span>
        </p>
      )}

      {list.ok && (
        <div className="card mt-6 p-4 sm:p-6">
          <p role="status" className="text-rio-slate">
            {list.data.total === 0 ? "No registrations match." : `${list.data.total.toLocaleString("en-IN")} registration${list.data.total === 1 ? "" : "s"}. Page ${list.data.page} of ${Math.max(1, Math.ceil(list.data.total / list.data.pageSize))}.`}
          </p>
          <ul className="mt-2 divide-y divide-rio-navy/10">
            {list.data.registrations.map((r) => (
              <li key={r.entryCode}>
                <Link href={`/admin/registrations/${r.entryCode}`} className="grid min-h-11 gap-x-4 gap-y-1 py-3 hover:bg-rio-blush sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,14rem)]">
                  <span className="font-mono font-bold text-rio-navy">{r.entryCode}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-semibold text-rio-navy">{r.childName}</span>, {r.childAge}
                    <span className="block text-sm text-rio-slate">Guardian: {r.guardianName} · {r.competitionNameEn} · questions v{r.questionSetVersion} · {r.answered} answered</span>
                  </span>
                  <span className="text-sm text-rio-slate sm:text-right">
                    <strong className="text-rio-navy">{STATUS[r.status] ?? r.status}</strong>
                    {r.openDuplicateFlag && <span className="ml-2 rounded-full bg-rio-blush px-2 py-0.5 text-xs font-bold text-rio-rose">Possible duplicate</span>}
                    {r.hasVideo !== undefined && (
                      <span className={`mt-1 block w-fit rounded-full border px-2 py-0.5 text-xs font-bold sm:ml-auto ${r.hasVideo ? "border-rio-ok/40 text-rio-ok" : "border-rio-slate/30 text-rio-slate"}`}>
                        {r.hasVideo ? "Video uploaded / வீடியோ உள்ளது" : "No video yet / வீடியோ இல்லை"}
                      </span>
                    )}
                    <span className="block">{formatIst(r.createdAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3">
            {list.data.page > 1 ? <Link href={pageLink(list.data.page - 1)} className="btn btn-outline">← Previous</Link> : <span />}
            {list.data.page * list.data.pageSize < list.data.total ? <Link href={pageLink(list.data.page + 1)} className="btn btn-outline">Next →</Link> : <span />}
          </nav>
        </div>
      )}
    </section>
  );
}
