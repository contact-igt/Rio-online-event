import type { Metadata } from "next";
import { JudgeRoster } from "@/components/admin/judge-roster";
import { JudgeTabs } from "@/components/admin/judge-tabs";
import { ProvisionJudgeForm } from "@/components/admin/provision-judge-form";
import { Icon } from "@/components/ui/icon";
import { loadJudgesList } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "நடுவர்கள் · Judges · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminJudgesPage() {
  // The session check and the data load are independent round trips, so they run together; the page still renders only after the check passes.
  const [session, judgesRes] = await Promise.all([requireStaff("admin"), loadJudgesList()]);

  const rosterHeading = (
    <h2 className="flex items-center gap-2.5 text-lg font-semibold leading-snug text-rio-navy">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rio-blush text-rio-rose"><Icon name="users" className="h-5 w-5" /></span>
      <span><span lang="ta" className="block">நடுவர் பட்டியல்</span><span lang="en" className="block text-sm font-medium text-rio-slate">Judge roster</span></span>
    </h2>
  );

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <p lang="en" className="eyebrow">
        <span aria-hidden="true" className="h-px w-8 bg-current" />
        Judge management
      </p>
      <h1 className="mt-2 text-[clamp(1.75rem,4vw,2rem)] font-bold leading-tight text-rio-navy">
        <span lang="ta" className="block">நடுவர்கள்</span>
        <span lang="en" className="mt-0.5 block text-base font-medium leading-snug text-rio-slate sm:text-lg">Judges</span>
      </h1>

      <JudgeTabs canSeeDeleted={session.role === "super_admin"} />

      {session.role === "super_admin" && (
        <div className="card mt-6 p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold leading-snug text-rio-navy">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rio-blush text-rio-rose"><Icon name="user" className="h-4 w-4" /></span>
            <span>Add judge <span lang="ta" className="font-medium text-rio-slate">/ நடுவரைச் சேர்க்க</span></span>
          </h2>
          <div className="mt-3"><ProvisionJudgeForm enabled={true} secretKey="ok" /></div>
        </div>
      )}

      <div className="card mt-6 p-4 sm:p-5">
        {!(judgesRes.ok && judgesRes.data.length > 0) && rosterHeading}

        {!judgesRes.ok && (
          <p role="alert" className="mt-4 flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-4 text-sm font-semibold leading-snug text-rio-error sm:p-5">
            <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
            <span className="min-w-0">
              Could not load the judges list from the server.
              <span lang="ta" className="mt-1 block font-medium leading-[1.5]">நடுவர் பட்டியலை ஏற்ற முடியவில்லை.</span>
            </span>
          </p>
        )}

        {judgesRes.ok && judgesRes.data.length === 0 && (
          <p className="mt-4 rounded-xl bg-rio-mist px-4 py-3 text-sm leading-snug text-rio-slate">
            No judges available yet. Use the form above to provision your first judge account.
            <span lang="ta" className="mt-1 block font-medium leading-[1.5]">நடுவர்கள் இன்னும் சேர்க்கப்படவில்லை.</span>
          </p>
        )}

        {judgesRes.ok && judgesRes.data.length > 0 && <JudgeRoster judges={judgesRes.data} canManage={session.role === "super_admin"} heading={rosterHeading} />}
      </div>
    </section>
  );
}
