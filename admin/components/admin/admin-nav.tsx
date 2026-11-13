"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";

// One persistent admin navigation for every protected page. The layout owns its navy surface;
// this component owns the brand block, routes, and active state.
type Item = { label: string; ta: string; icon: IconName; href: string; active?: (path: string) => boolean };

const items: Item[] = [
  { label: "Dashboard", ta: "முகப்பு", icon: "list", href: "/admin", active: (p) => p === "/admin" },
  { label: "Registrations", ta: "பதிவுகள்", icon: "clipboard", href: "/admin/registrations", active: (p) => p.startsWith("/admin/registrations") },
  { label: "Judges", ta: "நடுவர்கள்", icon: "user", href: "/admin/judges", active: (p) => p.startsWith("/admin/judges") },
  { label: "Questions", ta: "கேள்விகள்", icon: "edit", href: "/admin/questions", active: (p) => p.startsWith("/admin/questions") || /questions$/.test(p) },
  { label: "Assign Judges", ta: "நடுவரை ஒதுக்கு", icon: "users", href: "/admin/assign-judges", active: (p) => p.startsWith("/admin/assign-judges") },
  { label: "Scoring", ta: "மதிப்பெண்கள்", icon: "star", href: "/admin/scoring", active: (p) => p.startsWith("/admin/scoring") },
  { label: "Results", ta: "முடிவுகள்", icon: "trophy", href: "/admin/results", active: (p) => p.startsWith("/admin/results") },
  { label: "Event Settings", ta: "நிகழ்வு அமைப்புகள்", icon: "calendar", href: "/admin/settings", active: (p) => p.startsWith("/admin/settings") },
];

export function AdminNav() {
  const path = usePathname() ?? "/admin";
  return (
    <div className="flex min-h-full flex-col px-3 py-5 sm:px-4 lg:px-3 lg:py-7">
      <Link href="/admin" className="flex items-center gap-3 rounded-2xl px-3 py-2 text-white hover:bg-white/10" aria-label="RIO Admin Panel">
        {/* The admin app serves the same supplied logo file as the public website. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/rio logo v2.png" alt="RIO" className="h-14 w-auto object-contain" />
        <span className="hidden text-lg font-bold leading-tight sm:block lg:hidden xl:block">Admin Panel</span>
      </Link>
      <nav aria-label="Administration" className="mt-8">
        <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
          {items.map((it) => {
            const current = it.active?.(path) ?? path.startsWith(it.href);
            return (
              <li key={it.label} className="w-full lg:w-full">
                <Link
                  href={it.href}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 font-semibold leading-tight transition-colors ${current ? "bg-rio-rose text-white shadow-lg shadow-black/10" : "text-white/95 hover:bg-white/10"}`}
                >
                  <Icon name={it.icon} className="h-6 w-6" />
                  <span>
                    {it.label}
                    <span lang="ta" className={`block text-xs font-medium leading-[1.45] ${current ? "text-white" : "text-white/75"}`}>{it.ta}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
