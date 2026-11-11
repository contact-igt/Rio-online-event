import type { Metadata } from "next";
import Link from "next/link";
import { CompetitionLinks } from "@/components/admin/competition-links";
import { Icon } from "@/components/ui/icon";
import { loadCompetitions } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "Questions · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

// Landing page for the sidebar's Questions entry: choose a competition, then manage its questions.
export default async function AdminQuestionsPage() {
  await requireStaff("admin");
  const competitions = await loadCompetitions();

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6 lg:px-8">
      <h1 className="text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold">
        கேள்விகள்
        <span lang="en" className="block text-[0.6em] font-bold text-rio-slate">Questions</span>
      </h1>
      <div className="card mt-6 max-w-3xl p-4 sm:p-6">
        <h2 className="flex items-center gap-3 font-display text-2xl font-bold text-rio-navy">
          <Icon name="edit" className="h-7 w-7 text-rio-rose" />
          Choose a competition <span lang="ta" className="font-medium">/ போட்டியைத் தேர்ந்தெடுங்கள்</span>
        </h2>
        {competitions.ok ? (
          <CompetitionLinks competitions={competitions.data} />
        ) : (
          <p role="alert" className="mt-4 font-semibold text-rio-error">
            The competitions could not be loaded. Reload to try again.
            <span lang="ta" className="block font-medium">போட்டிகளை ஏற்ற முடியவில்லை.</span>
          </p>
        )}
      </div>
      <Link href="/admin" className="btn btn-outline mt-6 w-full sm:w-auto">
        Back / திரும்பு
      </Link>
    </section>
  );
}
