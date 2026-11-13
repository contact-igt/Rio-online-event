import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiNotReady } from "@/components/admin/api-not-ready";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "Scoring · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ScoringDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireStaff("admin");
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) notFound();

  return (
    <ApiNotReady
      eyebrow="Scoring management"
      title="Scoring"
      titleTa="மதிப்பீடுகள்"
      description="The competition scoring detail workspace will appear when the administrator scoring API is available."
      icon="star"
      messageEn="Scoring management is not available yet."
      messageTa="நிர்வாக மதிப்பீட்டு பணியிடம் இன்னும் தயாராகவில்லை."
      back="/admin/scoring"
    />
  );
}
