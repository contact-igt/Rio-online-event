import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { formatIst } from "@/lib/admin/format";
import type { Dashboard, Loaded } from "@/lib/admin/api";

// The dashboard figures. Zero is shown as 0 and an empty list as an explanation; if the API cannot answer, the panel says so instead of
// showing numbers.

const STATUS: Record<string, string> = { draft: "Draft", held: "Held", finalized: "Finalized", withdrawn: "Withdrawn", rejected: "Rejected" };

const STAT_TONES = [
  { card: "bg-rio-blush border-rio-rose/10", icon: "bg-pink-100 text-rio-rose" },
  { card: "bg-rio-mist border-sky-200/70", icon: "bg-sky-100 text-sky-600" },
  { card: "bg-violet-50 border-violet-200/70", icon: "bg-violet-100 text-violet-600" },
  { card: "bg-emerald-50 border-emerald-200/70", icon: "bg-emerald-100 text-emerald-600" },
  { card: "bg-amber-50 border-amber-200/70", icon: "bg-amber-100 text-amber-700" },
  { card: "bg-indigo-50 border-indigo-200/70", icon: "bg-indigo-100 text-indigo-600" },
] as const;

function Stat({ icon, en, ta, value, tone }: { icon: IconName; en: string; ta: string; value: number; tone: (typeof STAT_TONES)[number] }) {
  return (
    <div className={`rounded-2xl border p-3.5 ${tone.card}`}>
      <dt className="flex items-start gap-2 text-[0.8125rem] font-medium leading-snug text-rio-slate">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone.icon}`}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <span>
          <span className="block">{en}</span>
          <span lang="ta" className="block text-xs leading-[1.45]">{ta}</span>
        </span>
      </dt>
      <dd className="mt-2 font-display text-[1.75rem] font-bold leading-none text-rio-navy">{value.toLocaleString("en-IN")}</dd>
    </div>
  );
}

export function DashboardPanel({ loaded }: { loaded: Loaded<Dashboard> }) {
  if (!loaded.ok) {
    return (
      <div className="card p-4 sm:p-5">
        <p role="alert" className="flex items-start gap-3 rounded-xl border border-rio-error/40 bg-white p-3 text-sm font-semibold leading-snug text-rio-error">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">
            The figures could not be loaded{loaded.reason === "forbidden" ? ": your session cannot read them" : ". The server is not reachable"}. No numbers are shown rather than guessed ones. Reload to try again.
            <span lang="ta" className="mt-1 block font-medium leading-[1.5]">தரவை ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள்.</span>
          </span>
        </p>
      </div>
    );
  }
  const d = loaded.data;
  return (
    <>
      <div className="card p-4 sm:p-5">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold leading-snug text-rio-navy">
          <Icon name="clipboard" className="h-5 w-5 shrink-0 text-rio-rose" />
          <span className="min-w-0">
            <span lang="ta" className="block">கண்ணோட்டம்</span>
            <span lang="en" className="block text-sm font-medium text-rio-slate">Overview</span>
          </span>
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat icon="trophy" en="Competitions" ta="போட்டிகள்" value={d.competitions.total} tone={STAT_TONES[0]} />
          <Stat icon="list" en="Registrations" ta="பதிவுகள்" value={d.registrations.total} tone={STAT_TONES[1]} />
          <Stat icon="edit" en="Drafts" ta="வரைவுகள்" value={d.registrations.draft} tone={STAT_TONES[2]} />
          <Stat icon="check" en="Finalized" ta="இறுதி செய்தவை" value={d.registrations.finalized} tone={STAT_TONES[3]} />
          <Stat icon="info" en="Held / flagged" ta="நிறுத்தி வைத்தவை" value={d.registrations.held} tone={STAT_TONES[4]} />
          <Stat icon="user" en="Active judges" ta="செயலில் உள்ள நடுவர்கள்" value={d.judges.active} tone={STAT_TONES[5]} />
        </dl>
        <p role="status" className="mt-3 flex items-start gap-2.5 rounded-xl bg-rio-mist px-3 py-2.5 text-sm leading-snug">
          <Icon name="calendar" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">
            Registration is <strong>{d.registration.open ? "open" : "closed"}</strong>.{" "}
            {d.registration.opensAt && d.registration.closesAt ? `Window: ${formatIst(d.registration.opensAt)} to ${formatIst(d.registration.closesAt)} (IST).` : "No window is scheduled."}{" "}
            <Link href="/admin/settings" className="font-semibold text-rio-rose underline underline-offset-2">Event settings</Link>
          </span>
        </p>
      </div>

      <div className="card p-4 sm:p-5">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold leading-snug text-rio-navy">
          <Icon name="list" className="h-5 w-5 shrink-0 text-rio-rose" />
          <span className="min-w-0">
            <span lang="ta" className="block">சமீபத்திய பதிவுகள்</span>
            <span lang="en" className="block text-sm font-medium text-rio-slate">Recent registrations</span>
          </span>
        </h2>
        {d.recent.length === 0 ? (
          <p className="mt-3 text-sm leading-snug text-rio-slate">
            No registrations yet. They will appear here once registration opens.
            <span lang="ta" className="mt-1 block text-xs">இன்னும் பதிவுகள் இல்லை.</span>
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-rio-navy/10">
            {d.recent.map((r) => (
              <li key={r.entryCode} className="grid gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:items-center">
                <span className="font-mono text-sm font-semibold text-rio-navy">{r.entryCode}</span>
                <span className="min-w-0 text-sm leading-snug [overflow-wrap:anywhere]">
                  <span lang="ta" className="block">{r.competitionNameTa}</span>
                  <span lang="en" className="block text-rio-slate">{r.competitionNameEn}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-rio-slate sm:justify-end">
                  <span className="chip text-xs">{STATUS[r.status] ?? r.status}</span>
                  <span>{formatIst(r.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
