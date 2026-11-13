import type { Metadata } from "next";
import Link from "next/link";
import { Icon, eventIcon } from "@/components/ui/icon";
import { DashboardPanel } from "@/components/admin/dashboard-panel";
import { loadCompetitions, loadDashboard } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";
import { staff } from "@/lib/staff/messages";

export const metadata: Metadata = { title: "நிர்வாகம் · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

// The figures come from GET /admin/dashboard (MariaDB through the Express API). If the API is unreachable the panel says so; nothing is invented.
export default async function AdminPage() {
  // The session check and the data load are independent round trips, so they run together; the page still renders only after the check passes.
  const [{ user }, dashboard, competitions] = await Promise.all([requireStaff("admin"), loadDashboard(), loadCompetitions()]);

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <p lang="en" className="eyebrow">
        <span aria-hidden="true" className="h-px w-8 bg-current" />
        Children&apos;s Day Celebration 2026
      </p>
      <h1 className="mt-2 text-[clamp(1.75rem,5vw,2rem)] font-bold leading-tight">
        <span className="block">{staff.admin.title.ta}</span>
        <span lang="en" className="mt-0.5 block text-base font-medium leading-snug text-rio-slate sm:text-lg">{staff.admin.title.en}</span>
      </h1>
      <p className="mt-4 flex max-w-4xl items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-medium leading-snug text-rio-navy sm:px-4">
        <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <span className="min-w-0">
          <span lang="ta" className="block font-semibold">{staff.admin.private.ta}</span>
          <span lang="en" className="block">{staff.admin.private.en}</span>
        </span>
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] lg:items-start">
        <div className="min-w-0 space-y-4">
          <DashboardPanel loaded={dashboard} />

          <div id="competitions" className="card scroll-mt-4 p-4 sm:p-5">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold leading-snug text-rio-navy">
              <Icon name="trophy" className="h-5 w-5 shrink-0 text-rio-rose" />
              <span className="min-w-0">
                <span lang="ta" className="block">{staff.admin.competitions.ta}</span>
                <span lang="en" className="block text-sm font-medium text-rio-slate">{staff.admin.competitions.en}</span>
              </span>
            </h2>
            {!competitions.ok && <p role="alert" className="mt-3 text-sm font-semibold leading-snug text-rio-error">The competitions could not be loaded. Reload to try again. <span lang="ta" className="mt-1 block font-medium">போட்டிகளை ஏற்ற முடியவில்லை.</span></p>}
            {competitions.ok && competitions.data.length === 0 && <p className="mt-3 text-sm leading-snug text-rio-slate">No competitions exist in the database yet. They are added with the seed command, not from this screen.</p>}
            <ul className="mt-3 divide-y divide-rio-navy/10">
              {(competitions.ok ? competitions.data : []).map((e) => (
                <li key={e.slug}>
                  <Link href={`/admin/events/${e.slug}`} className="flex min-h-11 items-center justify-between gap-3 py-2.5 text-rio-navy hover:text-rio-rose">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Icon name={eventIcon[e.slug] ?? "star"} className="h-5 w-5 shrink-0 text-rio-rose" />
                      <span className="min-w-0 text-sm font-semibold leading-snug [overflow-wrap:anywhere]">
                        <span lang="ta" className="block">{e.nameTa}</span>
                        <span lang="en" className="block font-medium text-rio-slate">{e.nameEn}</span>
                        <span className="mt-0.5 block text-xs font-medium text-rio-slate">{e.published ? `Published v${e.published.version}` : "No published questions"}{e.draft ? ` · Draft v${e.draft.version}` : ""}</span>
                      </span>
                    </span>
                    <Icon name="chevron" className="h-4 w-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <aside className="min-w-0 space-y-4">
          <div className="card p-4 sm:p-5">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold leading-snug text-rio-navy">
              <Icon name="user" className="h-5 w-5 shrink-0 text-rio-rose" />
              <span className="min-w-0">
                <span lang="ta" className="block">உள்நுழைந்தவர்</span>
                <span lang="en" className="block text-sm font-medium text-rio-slate">Signed in</span>
              </span>
            </h2>
            <dl className="mt-2 divide-y divide-rio-navy/10">
              <div className="grid gap-x-4 gap-y-0.5 border-t border-rio-navy/10 py-2.5 first:border-0 sm:grid-cols-[minmax(0,5rem)_minmax(0,1fr)]">
                <dt className="text-xs font-medium text-rio-slate">Name</dt>
                <dd className="text-sm font-semibold leading-snug text-rio-navy">{user.displayName}</dd>
              </div>
              <div className="grid gap-x-4 gap-y-0.5 border-t border-rio-navy/10 py-2.5 first:border-0 sm:grid-cols-[minmax(0,5rem)_minmax(0,1fr)]">
                <dt className="text-xs font-medium text-rio-slate">Email</dt>
                <dd className="text-sm font-semibold leading-snug text-rio-navy [overflow-wrap:anywhere]">{user.email}</dd>
              </div>
              <div className="grid gap-x-4 gap-y-0.5 border-t border-rio-navy/10 py-2.5 first:border-0 sm:grid-cols-[minmax(0,5rem)_minmax(0,1fr)]">
                <dt className="text-xs font-medium text-rio-slate">Role</dt>
                <dd className="text-sm font-semibold leading-snug text-rio-navy"><span className="chip bg-rio-blush text-rio-rose">{user.role === "super_admin" ? "Super Admin" : "Administrator"}</span></dd>
              </div>
            </dl>
          </div>

          <div className="card p-4 sm:p-5">
            <h2 className="flex items-center gap-2.5 text-lg font-semibold leading-snug text-rio-navy">
              <Icon name="list" className="h-5 w-5 shrink-0 text-rio-rose" />
              <span className="min-w-0">
                <span lang="ta" className="block">நிர்வாகச் செயல்கள்</span>
                <span lang="en" className="block text-sm font-medium text-rio-slate">Management</span>
              </span>
            </h2>
            <ul className="mt-2">
              {[{ href: "/admin/registrations", label: "Registrations" }, { href: "/admin/judges", label: "Judges" }, { href: "/admin/settings", label: "Event settings" }].map((l) => (
                <li key={l.href} className="pt-2 first:pt-0">
                  <Link href={l.href} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-rio-mist/70 px-3 py-2 text-sm font-semibold text-rio-navy hover:bg-rio-mist hover:text-rio-rose">
                    <span>{l.label}</span>
                    <Icon name="chevron" className="h-4 w-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}
