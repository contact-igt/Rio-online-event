import type { Metadata } from "next";
import Link from "next/link";
import { SettingsForm } from "@/components/admin/settings-form";
import { Icon } from "@/components/ui/icon";
import { loadSettings } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "Event settings · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireStaff("admin");
  const loaded = await loadSettings();

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6 lg:px-8">
      <h1 className="text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold">
        நிகழ்வு அமைப்புகள்
        <span lang="en" className="block text-[0.6em] font-bold text-rio-slate">Event settings</span>
      </h1>
      <div className="card mt-6 max-w-3xl p-4 sm:p-6">
        <h2 className="flex items-center gap-3 font-display text-2xl font-bold text-rio-navy">
          <Icon name="calendar" className="h-7 w-7 text-rio-rose" />
          Registration window and results
        </h2>
        <div className="mt-4">
          {loaded.ok ? (
            <SettingsForm settings={loaded.data} />
          ) : (
            <p role="alert" className="flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-3 font-semibold text-rio-error">
              <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                The settings could not be loaded{loaded.reason === "forbidden" ? ": your session cannot read them" : ". The server is not reachable"}. Nothing is shown rather than guessed values. Reload to try again.
                <span lang="ta" className="mt-1 block font-medium">அமைப்புகளை ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள்.</span>
              </span>
            </p>
          )}
        </div>
      </div>
      <Link href="/admin" className="btn btn-outline mt-6 w-full sm:w-auto">
        Back / திரும்பு
      </Link>
    </section>
  );
}
