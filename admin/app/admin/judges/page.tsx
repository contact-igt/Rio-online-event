import type { Metadata } from "next";
import { JudgeActiveButton } from "@/components/admin/judge-active-button";
import { JudgeResetButton } from "@/components/admin/judge-reset-button";
import { ProvisionJudgeForm } from "@/components/admin/provision-judge-form";
import { Icon } from "@/components/ui/icon";
import { loadJudgesList } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "நடுவர்கள் · Judges · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminJudgesPage() {
  await requireStaff("admin");
  const judgesRes = await loadJudgesList();

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h1 className="text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold text-rio-navy">
          Judges
          <span lang="ta" className="block text-[0.6em] font-bold text-rio-slate">
            நடுவர்கள்
          </span>
        </h1>
      </div>

      {/* Add Judge Section */}
      <div className="card mt-6 p-6">
        <h2 className="text-xl font-bold text-rio-navy">
          Add Judge <span lang="ta" className="text-base font-semibold text-rio-slate">/ நடுவரைச் சேர்க்க</span>
        </h2>
        <div className="mt-4">
          <ProvisionJudgeForm enabled={true} secretKey="ok" />
        </div>
      </div>

      {/* Judges List Section */}
      <div className="card mt-8 p-6">
        <h2 className="text-xl font-bold text-rio-navy">
          Judge Roster <span lang="ta" className="text-base font-semibold text-rio-slate">/ நடுவர் பட்டியல்</span>
        </h2>

        {!judgesRes.ok && (
          <p role="alert" className="mt-4 flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-4 font-semibold text-rio-error">
            <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              Could not load the judges list from the server.
              <span lang="ta" className="mt-1 block font-medium">நடுவர் பட்டியலை ஏற்ற முடியவில்லை.</span>
            </span>
          </p>
        )}

        {judgesRes.ok && judgesRes.data.length === 0 && (
          <p className="mt-4 text-rio-slate">
            No judges have been added yet. Use the form above to provision your first judge account.
            <span lang="ta" className="mt-1 block font-medium">நடுவர்கள் இன்னும் சேர்க்கப்படவில்லை.</span>
          </p>
        )}

        {judgesRes.ok && judgesRes.data.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm text-rio-ink">
              <thead className="border-b border-rio-navy/15 text-xs uppercase tracking-wider text-rio-slate">
                <tr>
                  <th scope="col" className="pb-3 pr-4 font-bold text-rio-navy">Judge / Code</th>
                  <th scope="col" className="pb-3 px-4 font-bold text-rio-navy">Email</th>
                  <th scope="col" className="pb-3 px-4 font-bold text-rio-navy">Status</th>
                  <th scope="col" className="pb-3 px-4 font-bold text-rio-navy">Progress (Scored)</th>
                  <th scope="col" className="pb-3 pl-4 font-bold text-rio-navy sm:text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rio-navy/10">
                {judgesRes.data.map((j) => (
                  <tr key={j.id} className="hover:bg-rio-blush/40 transition-colors">
                    <td className="py-4 pr-4">
                      <span className="font-semibold text-rio-navy">{j.name}</span>
                      <span className="block font-mono text-xs text-rio-slate">{j.judgeCode}</span>
                    </td>
                    <td className="py-4 px-4 font-mono text-xs text-rio-slate">
                      {j.email}
                      {j.mustChangePassword && (
                        <span className="block text-[11px] text-amber-700 font-sans font-semibold">
                          Must change password
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          j.active ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-700"
                        }`}
                      >
                        {j.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="font-semibold text-rio-navy">
                        {j.final} / {j.assigned}
                      </span>
                      <span className="block text-xs text-rio-slate">
                        {j.progress !== null ? `${j.progress}% completed` : "No entries"} · {j.drafts} draft{j.drafts === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="py-4 pl-4 sm:text-right">
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <JudgeActiveButton judgeId={String(j.id)} name={j.name} active={j.active} />
                        <JudgeResetButton judgeId={String(j.id)} name={j.name} email={j.email} ready={true} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
