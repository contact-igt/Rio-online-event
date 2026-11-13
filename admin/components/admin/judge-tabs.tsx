"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Active and Deleted judges are two pages; the highlighted tab follows the current path, so refresh, Back and Forward always show the right one.
// Only the Super Admin is shown (and allowed on) the Deleted page.
export function JudgeTabs({ canSeeDeleted }: { canSeeDeleted: boolean }) {
  const onDeleted = usePathname().startsWith("/admin/judges/deleted");
  const tab = (active: boolean) => `rounded-xl px-4 py-2.5 text-sm font-bold ${active ? "bg-rio-rose text-white shadow-sm" : "text-rio-slate hover:bg-rio-blush"}`;
  if (!canSeeDeleted) return null;
  return (
    <nav aria-label="Judge views" className="mt-6 flex max-w-max flex-wrap gap-1 rounded-2xl border border-rio-navy/10 bg-white/80 p-1">
      <Link href="/admin/judges" aria-current={onDeleted ? undefined : "page"} className={tab(!onDeleted)}>Active judges</Link>
      <Link href="/admin/judges/deleted" aria-current={onDeleted ? "page" : undefined} className={tab(onDeleted)}>Deleted judges</Link>
    </nav>
  );
}
