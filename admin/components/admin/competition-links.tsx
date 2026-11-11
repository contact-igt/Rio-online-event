import Link from "next/link";
import type { Competition } from "@/lib/admin/api";

// The list on the Questions page: one link per competition to its Question Builder. An empty list is stated, never redirected away from.
export function CompetitionLinks({ competitions }: { competitions: Competition[] }) {
  if (competitions.length === 0) {
    return (
      <p className="mt-4 text-rio-slate">
        No competitions available yet.
        <span lang="ta" className="block">இன்னும் போட்டிகள் இல்லை.</span>
      </p>
    );
  }
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {competitions.map((c) => (
        <li key={c.slug}>
          <Link href={`/admin/events/${c.slug}/questions`} className="flex min-h-11 flex-col rounded-2xl bg-white p-3 font-semibold text-rio-navy hover:bg-rio-blush">
            <span lang="ta">{c.nameTa}</span>
            <span className="text-sm font-medium text-rio-slate">{c.nameEn}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
