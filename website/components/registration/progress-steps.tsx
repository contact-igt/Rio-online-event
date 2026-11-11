import { Icon } from "@/components/ui/icon";
import { reg } from "@/lib/registration/messages";

export type Stage = "none" | "draft" | "uploaded" | "finalized";

const order: Stage[] = ["none", "draft", "uploaded", "finalized"];

export function ProgressSteps({ stage }: { stage: Stage }) {
  const at = order.indexOf(stage);
  const steps = [
    { m: reg.progress.choose, done: true },
    { m: reg.progress.details, done: at >= 1 },
    { m: reg.progress.video, done: at >= 2 },
    { m: reg.progress.submit, done: at >= 3 },
  ];
  const nextIndex = Math.max(0, steps.findIndex((s) => !s.done));
  const currentStep = steps[nextIndex] ?? steps[1]!;
  const pct = Math.round(((nextIndex + 1) / steps.length) * 100);

  return (
    <section aria-labelledby="progress-title" className="rounded-2xl border border-slate-200/80 bg-white/90 p-3.5 sm:p-5 shadow-2xs">
      <h2 id="progress-title" className="sr-only">
        {reg.progress.title.ta} / {reg.progress.title.en}
      </h2>

      {/* Mobile compact stepper (< sm) */}
      <div className="sm:hidden space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-rio-rose inline-flex items-center gap-1.5">
            <span className="grid size-5 place-items-center rounded-full bg-rio-rose text-white text-[11px] font-bold">
              {nextIndex + 1}
            </span>
            Step {nextIndex + 1} of {steps.length}
          </span>
          <span className="font-semibold text-rio-slate">{pct}% completed</span>
        </div>
        <p className="font-bold text-rio-navy text-sm">
          {currentStep.m.ta} <span lang="en" className="text-rio-slate font-medium text-xs">/ {currentStep.m.en}</span>
        </p>
        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
          <div className="bg-rio-rose h-1.5 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Desktop & tablet stepper (>= sm) */}
      <ol className="hidden sm:grid sm:grid-cols-4 sm:gap-4">
        {steps.map((s, i) => {
          const state = s.done ? reg.progress.done : i === nextIndex ? reg.progress.next : reg.progress.later;
          const current = i === nextIndex;
          return (
            <li key={s.m.en} aria-current={current ? "step" : undefined} className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className={`grid size-9 shrink-0 place-items-center rounded-full font-bold text-sm transition-colors ${
                  s.done
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-300"
                    : current
                      ? "bg-rio-rose text-white shadow-md shadow-rio-rose/30"
                      : "border border-slate-300 bg-white text-slate-400"
                }`}
              >
                {s.done ? <Icon name="check" className="h-4 w-4" /> : i + 1}
              </span>
              <div className="min-w-0 leading-tight">
                <span className={`block font-bold text-xs sm:text-sm truncate ${current ? "text-rio-rose" : "text-rio-navy"}`}>
                  {i + 1}. {s.m.en}
                </span>
                <span lang="ta" className="block text-xs text-rio-slate truncate mt-0.5">
                  {s.m.ta}
                </span>
                <span className={`mt-1 block text-[10px] font-bold uppercase tracking-wider ${current ? "text-rio-rose" : "text-slate-400"}`}>
                  {state.en}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
