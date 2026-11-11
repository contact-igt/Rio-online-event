import { Icon, eventIcon } from "@/components/ui/icon";
import { rules, type CompetitionEvent } from "@/lib/events";

// The competition the parent chose, beside the form: name, age band, video length, mode and the task.
// Mobile-optimized: compact on small screens with collapsible about section, fully expanded on desktop.
export function EventSummary({ event }: { event: CompetitionEvent }) {
  const facts = [
    { icon: "users", ta: "வயது வரம்பு", en: "Age band", value: `${event.minAge} – ${event.maxAge} yrs` },
    { icon: "video", ta: "வீடியோ நீளம்", en: "Video length", value: `${rules.videoSeconds.min}–${rules.videoSeconds.max}s` },
    { icon: "laptop", ta: "முறை", en: "Mode", value: "Online" },
  ] as const;

  return (
    <aside aria-labelledby="summary-title" className="card-soft p-4 sm:p-6 lg:sticky lg:top-6">
      <div className="flex items-center gap-3.5">
        <span aria-hidden="true" className="grid size-12 sm:size-14 shrink-0 place-items-center rounded-2xl bg-white text-rio-rose shadow-xs">
          <Icon name={eventIcon[event.slug] ?? "star"} className="h-6 w-6 sm:h-8 sm:w-8" />
        </span>
        <div className="min-w-0">
          <h2 id="summary-title" className="text-lg sm:text-xl font-bold leading-snug [overflow-wrap:anywhere] text-rio-navy">
            {event.nameTa}
          </h2>
          <p lang="en" className="font-display text-sm sm:text-base font-semibold text-rio-slate">
            {event.nameEn}
          </p>
        </div>
      </div>

      <ul className="mt-3.5 grid grid-cols-3 gap-2">
        {facts.map((f) => (
          <li key={f.en} className="flex min-w-0 flex-col items-center gap-0.5 rounded-xl sm:rounded-2xl bg-white/90 px-1 py-2 sm:py-3 text-center shadow-2xs">
            <Icon name={f.icon} className="h-4 sm:h-5 w-4 sm:w-5 text-rio-rose" />
            <span className="text-[11px] sm:text-xs font-semibold leading-tight text-rio-navy">{f.ta}</span>
            <span lang="en" className="text-[10px] sm:text-xs leading-tight text-rio-slate">{f.en}</span>
            <span lang="en" className="text-xs sm:text-sm font-bold leading-tight text-rio-navy mt-0.5 [overflow-wrap:anywhere]">{f.value}</span>
          </li>
        ))}
      </ul>

      <details className="group mt-3.5 border-t border-rose-200/50 pt-2.5 lg:open cursor-pointer list-none">
        <summary className="flex items-center justify-between text-xs sm:text-sm font-bold text-rio-navy hover:text-rio-rose transition-colors py-1">
          <span>இந்தப் போட்டியைப் பற்றி <span lang="en" className="font-semibold text-rio-slate">/ About</span></span>
          <Icon name="chevron" className="h-4 w-4 text-rio-slate transition-transform group-open:rotate-90 lg:hidden" />
        </summary>
        <div className="mt-2 text-xs sm:text-sm leading-relaxed space-y-1">
          <p className="font-medium text-rio-navy [overflow-wrap:anywhere]">{event.taskTa}</p>
          <p lang="en" className="text-rio-slate [overflow-wrap:anywhere]">{event.taskEn}</p>
        </div>
      </details>
    </aside>
  );
}
