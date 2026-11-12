"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The two views of the registrations area. Each is its own page; the highlighted one follows the current path, so refresh, Back and Forward
// always show the right tab. Only the Super Admin is shown (and allowed on) the Deleted page.
export function RegistrationTabs({ canSeeDeleted }: { canSeeDeleted: boolean }) {
  const onDeleted = usePathname().startsWith("/admin/registrations/deleted");
  const tab = (active: boolean) => `rounded-xl px-4 py-2.5 text-sm font-bold ${active ? "bg-rio-rose text-white shadow-sm" : "text-rio-slate hover:bg-rio-blush"}`;
  return (
    <nav aria-label="Registration views" className="mt-6 flex max-w-max flex-wrap gap-1 rounded-2xl border border-rio-navy/10 bg-white/80 p-1">
      <Link href="/admin/registrations" aria-current={onDeleted ? undefined : "page"} className={tab(!onDeleted)}>Active registrations</Link>
      {canSeeDeleted && <Link href="/admin/registrations/deleted" aria-current={onDeleted ? "page" : undefined} className={tab(onDeleted)}>Deleted registrations</Link>}
    </nav>
  );
}
