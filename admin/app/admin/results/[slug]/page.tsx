import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiNotReady } from "@/components/admin/api-not-ready";
import { requireStaff } from "@/lib/staff/auth";

export const metadata: Metadata = { title: "Results · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ResultsDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireStaff("admin");
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) notFound();

  return (
    <ApiNotReady
      eyebrow="Results management"
      title="Results"
      titleTa="முடிவுகள்"
      description="The competition results detail workspace will appear when the administrator results API is available."
      icon="trophy"
      messageEn="Results management is not available yet."
      messageTa="நிர்வாக முடிவுகள் பணியிடம் இன்னும் தயாராகவில்லை."
      back="/admin/results"
    />
  );
}
