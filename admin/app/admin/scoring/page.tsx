import type { Metadata } from "next";
import { ApiNotReady } from "@/components/admin/api-not-ready";
import { loadCompetitions } from "@/lib/admin/api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "Scoring · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ScoringPage() {
  // The session check and the data load are independent round trips, so they run together; the page still renders only after the check passes.
  const [, competitions] = await Promise.all([requireStaff("admin"), loadCompetitions()]);

  return (
    <>
      {!competitions.ok && <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8"><p role="alert" className="card p-4 font-semibold text-rio-error">Competition data is unavailable. Scoring management cannot be shown.</p></section>}
      {competitions.ok && competitions.data.length === 0 && <section className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8"><p className="card p-4 text-rio-slate">No competitions are available yet. Scoring management will be available once a competition exists.</p></section>}
      {competitions.ok && competitions.data.length > 0 && (
        <ApiNotReady
          eyebrow="Scoring management"
          title="Scoring"
          titleTa="மதிப்பீடுகள்"
          description="Monitor scoring progress when the administrator scoring workspace is available."
          icon="star"
          messageEn="Scoring management is not available yet."
          messageTa="நிர்வாக மதிப்பீட்டு பணியிடம் இன்னும் தயாராகவில்லை."
        />
      )}
    </>
  );
}
