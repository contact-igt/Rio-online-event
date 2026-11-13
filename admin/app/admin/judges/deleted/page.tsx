import type { Metadata } from "next";
import { DeletedJudgesList } from "@/components/admin/deleted-judges-list";
import { JudgeTabs } from "@/components/admin/judge-tabs";
import { Icon } from "@/components/ui/icon";
import { loadDeletedJudges } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "நீக்கிய நடுவர்கள் · Deleted judges · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

// Super Admin only: requireStaff answers anyone else with the same 404 as an unknown page, and the API checks the role again.
export default async function AdminDeletedJudgesPage() {
  const [, judgesRes] = await Promise.all([requireStaff("super_admin"), loadDeletedJudges()]);

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

      <JudgeTabs canSeeDeleted />

      <div className="card mt-6 p-4 sm:p-5">
        {!judgesRes.ok ? (
          <p role="alert" className="flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-4 text-sm font-semibold leading-snug text-rio-error">
            <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
            <span className="min-w-0">Could not load the deleted judges from the server.<span lang="ta" className="mt-1 block font-medium leading-[1.5]">நீக்கிய நடுவர்களை ஏற்ற முடியவில்லை.</span></span>
          </p>
        ) : (
          <DeletedJudgesList judges={judgesRes.data} />
        )}
      </div>
    </section>
  );
}
