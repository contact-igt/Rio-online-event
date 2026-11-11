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
      <div>
        <h1 className="text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold text-rio-navy">
          கேள்விகள்
          <span lang="en" className="block text-[0.55em] font-bold text-rio-slate">Competition Question Builder</span>
        </h1>
        <p className="mt-1 text-rio-slate text-sm sm:text-base">
          Customize questions for each competition. Published questions appear live on the parent registration form.
          <span lang="ta" className="block text-xs sm:text-sm text-rio-slate mt-0.5">ஒவ்வொரு போட்டிக்கும் தேவையான கேள்விகளை இங்கு மாற்றலாம்.</span>
        </p>
      </div>

      <div className="card mt-6 max-w-4xl p-5 sm:p-8 border border-rio-navy/10 shadow-sm">
        <h2 className="flex items-center gap-3 font-display text-xl sm:text-2xl font-bold text-rio-navy">
          <Icon name="edit" className="h-6 w-6 sm:h-7 sm:w-7 text-rio-rose" />
          Choose a competition <span lang="ta" className="font-medium text-rio-slate text-base sm:text-xl">/ போட்டியைத் தேர்ந்தெடுங்கள்</span>
        </h2>
        {competitions.ok ? (
          <div className="mt-5">
            <CompetitionLinks competitions={competitions.data} />
          </div>
        ) : (
          <p role="alert" className="mt-4 font-semibold text-rio-error">
            The competitions could not be loaded. Reload to try again.
            <span lang="ta" className="block font-medium">போட்டிகளை ஏற்ற முடியவில்லை.</span>
          </p>
        )}
      </div>

      <Link href="/admin" className="btn btn-outline mt-6 w-full sm:w-auto">
        Back to Dashboard / முகப்புக்குத் திரும்பு
      </Link>
    </section>
  );
}
