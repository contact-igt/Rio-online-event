import type { Metadata } from "next";
import Link from "next/link";
import { SettingsForm } from "@/components/admin/settings-form";
import { Icon } from "@/components/ui/icon";
import { loadSettings } from "@/lib/admin/api";
import { istMinuteNow } from "@/lib/event-settings/settings";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "Event settings · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // The session check and the data load are independent round trips, so they run together; the page still renders only after the check passes.
  const [, loaded] = await Promise.all([requireStaff("admin"), loadSettings()]);

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <p lang="en" className="eyebrow">
        <span aria-hidden="true" className="h-px w-8 bg-current" />
        Event configuration
      </p>
      <h1 className="mt-2 text-[clamp(1.75rem,4vw,2rem)] font-bold leading-tight text-rio-navy">
        <span lang="ta" className="block">நிகழ்வு அமைப்புகள்</span>
        <span lang="en" className="mt-0.5 block text-base font-medium leading-snug text-rio-slate sm:text-lg">Event settings</span>
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-rio-slate">Set the event window, consent reference, and results schedule using the existing server validation.</p>
      <div className="card mt-6 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rio-blush text-rio-rose"><Icon name="calendar" className="h-5 w-5" /></span>
          <div>
            <h2 className="text-lg font-semibold leading-snug text-rio-navy"><span lang="ta" className="block">நிகழ்வு அமைப்பு பணியிடம்</span><span lang="en" className="block text-sm font-medium text-rio-slate">Configuration workspace</span></h2>
            <p className="mt-1 text-sm text-rio-slate">Changes are checked and saved by the server.</p>
          </div>
        </div>
        <div className="mt-4">
          {loaded.ok ? (
            <SettingsForm settings={loaded.data} openMin={istMinuteNow(new Date())} />
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
