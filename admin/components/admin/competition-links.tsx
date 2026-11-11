import Link from "next/link";
import type { Competition } from "@/lib/admin/api";

// The competitions that share the one question list on the Questions page, each with the version its parents see now. Each links to the
// competition's own page. An empty list is stated, never redirected away from.
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
          <Link href={`/admin/events/${c.slug}`} className="flex min-h-11 flex-col rounded-2xl bg-white p-3 font-semibold text-rio-navy hover:bg-rio-blush">
            <span lang="ta">{c.nameTa}</span>
            <span className="text-sm font-medium text-rio-slate">{c.nameEn}</span>
            <span className="mt-1 text-sm font-medium text-rio-slate">
              {c.published ? `Parents see v${c.published.version} · ${c.published.questionCount} question${c.published.questionCount === 1 ? "" : "s"}` : "Not published yet"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
