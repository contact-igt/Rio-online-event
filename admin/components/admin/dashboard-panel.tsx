import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { formatIst } from "@/lib/admin/format";
import type { Dashboard, Loaded } from "@/lib/admin/api";

// The dashboard figures. Zero is shown as 0 and an empty list as an explanation; if the API cannot answer, the panel says so instead of
// showing numbers.

const STATUS: Record<string, string> = { draft: "Draft", held: "Held", finalized: "Finalized", withdrawn: "Withdrawn", rejected: "Rejected" };

function Stat({ icon, en, ta, value }: { icon: IconName; en: string; ta: string; value: number }) {
  return (
    <div className="rounded-2xl border border-rio-navy/10 bg-white p-4">
      <dt className="flex items-center gap-2 text-rio-slate">
        <Icon name={icon} className="h-5 w-5 shrink-0 text-rio-rose" />
        <span>
          {en} <span lang="ta" className="block text-sm">{ta}</span>
        </span>
      </dt>
      <dd className="mt-2 font-display text-3xl font-extrabold text-rio-navy">{value.toLocaleString("en-IN")}</dd>
    </div>
  );
}

export function DashboardPanel({ loaded }: { loaded: Loaded<Dashboard> }) {
  if (!loaded.ok) {
    return (
      <div className="card p-4 sm:p-6">
        <p role="alert" className="flex items-start gap-3 rounded-2xl border border-rio-error/40 bg-white p-3 font-semibold text-rio-error">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            The figures could not be loaded{loaded.reason === "forbidden" ? ": your session cannot read them" : ". The server is not reachable"}. No numbers are shown rather than guessed ones. Reload to try again.
            <span lang="ta" className="mt-1 block font-medium">தரவை ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள்.</span>
          </span>
        </p>
      </div>
    );
  }
  const d = loaded.data;
  return (
    <>
      <div className="card p-4 sm:p-6">
        <h2 className="flex items-center gap-3 font-display text-2xl font-bold text-rio-navy">
          <Icon name="clipboard" className="h-7 w-7 text-rio-rose" />
          <span className="min-w-0">Overview <span lang="ta" className="font-medium">/ கண்ணோட்டம்</span></span>
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat icon="trophy" en="Competitions" ta="போட்டிகள்" value={d.competitions.total} />
          <Stat icon="list" en="Registrations" ta="பதிவுகள்" value={d.registrations.total} />
          <Stat icon="edit" en="Drafts" ta="வரைவுகள்" value={d.registrations.draft} />
          <Stat icon="check" en="Finalized" ta="இறுதி செய்தவை" value={d.registrations.finalized} />
          <Stat icon="info" en="Held / flagged" ta="நிறுத்தி வைத்தவை" value={d.registrations.held} />
          <Stat icon="user" en="Active judges" ta="செயலில் உள்ள நடுவர்கள்" value={d.judges.active} />
        </dl>
        <p role="status" className="mt-4 flex items-start gap-3 rounded-2xl bg-rio-mist p-3">
          <Icon name="calendar" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            Registration is <strong>{d.registration.open ? "open" : "closed"}</strong>.{" "}
            {d.registration.opensAt && d.registration.closesAt ? `Window: ${formatIst(d.registration.opensAt)} to ${formatIst(d.registration.closesAt)} (IST).` : "No window is scheduled."}{" "}
            <Link href="/admin/settings" className="font-semibold text-rio-rose underline underline-offset-2">Event settings</Link>
          </span>
        </p>
      </div>

      <div className="card p-4 sm:p-6">
        <h2 className="flex items-center gap-3 font-display text-2xl font-bold text-rio-navy">
          <Icon name="list" className="h-7 w-7 text-rio-rose" />
          <span className="min-w-0">Recent registrations <span lang="ta" className="font-medium">/ சமீபத்திய பதிவுகள்</span></span>
        </h2>
        {d.recent.length === 0 ? (
          <p className="mt-3 text-rio-slate">
            No registrations yet. They will appear here once registration opens.
            <span lang="ta" className="block text-sm">இன்னும் பதிவுகள் இல்லை.</span>
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-rio-navy/10">
            {d.recent.map((r) => (
              <li key={r.entryCode} className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center">
                <span className="font-mono font-semibold text-rio-navy">{r.entryCode}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {r.competitionNameTa} / <span lang="en">{r.competitionNameEn}</span>
                </span>
                <span className="text-sm text-rio-slate">
                  <span className="chip">{STATUS[r.status] ?? r.status}</span> {formatIst(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
