import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import type { Competition } from "@/lib/admin/api";

const EVENT_ICON: Record<string, IconName> = {
  "malalai-mozhi": "smile",
  "kathai-sollum-kutties": "book",
  "thirukkural-thiramai": "scroll",
  "kutti-pesalar": "mic",
};

// The competitions list on the Questions page: each styled as a rich card with status, icon, and direct link to its question builder.
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
    <ul className="mt-4 grid gap-4 sm:grid-cols-2">
      {competitions.map((c) => {
        const iconName = EVENT_ICON[c.slug] ?? "star";
        const isPublished = Boolean(c.published && c.published.questionCount > 0);
        return (
          <li key={c.slug}>
            <Link
              href={`/admin/events/${c.slug}/questions`}
              className="group flex h-full flex-col justify-between rounded-2xl border-2 border-rio-navy/10 bg-white p-5 shadow-sm transition hover:border-rio-rose hover:bg-rio-blush/20 hover:shadow-md"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="grid size-11 place-items-center rounded-xl bg-rio-mist text-rio-navy transition-colors group-hover:bg-rio-rose group-hover:text-white">
                    <Icon name={iconName} className="h-6 w-6" />
                  </span>
                  {isPublished ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                      <Icon name="check" className="h-3.5 w-3.5" />
                      v{c.published!.version} Published ({c.published!.questionCount} Qs)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-rio-slate">
                      No questions yet
                    </span>
                  )}
                </div>
                <div className="mt-3">
                  <h3 className="font-display text-lg font-bold text-rio-navy transition-colors group-hover:text-rio-rose" lang="ta">
                    {c.nameTa}
                  </h3>
                  <p className="text-sm font-semibold text-rio-slate" lang="en">
                    {c.nameEn}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-rio-navy/10 pt-3 text-xs font-bold text-rio-rose">
                <span>Manage questions / கேள்விகளை நிர்வகி</span>
                <Icon name="arrow" className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
