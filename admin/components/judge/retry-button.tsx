"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { staff } from "@/lib/staff/messages";

// Asks the server for the page again (no full reload). Disabled while the request runs so it cannot be pressed twice.
export function RetryButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} aria-busy={pending} onClick={() => start(() => router.refresh())} className="btn btn-outline mt-3 min-h-10 !px-4 !py-1 text-sm">
      {staff.judge.retry.en} <span lang="ta" className="font-medium">/ {staff.judge.retry.ta}</span>
    </button>
  );
}
