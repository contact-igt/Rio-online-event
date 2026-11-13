import type { Queryable } from "../db/adapter.ts";
import { asDate } from "../db/values.ts";
import { loadSettings, registrationOpenAt } from "./settings.ts";

// Read-only figures for the administrator dashboard, straight from the database. An empty table is zero, never a placeholder.
// Nothing personal leaves here: recent activity shows the entry code, the competition and the status only (no child, guardian or contact data).

export type Dashboard = {
  competitions: { total: number; active: number };
  registrations: { total: number; draft: number; finalized: number; held: number; withdrawn: number; rejected: number };
  judges: { active: number };
  registration: { open: boolean; opensAt: string | null; closesAt: string | null };
  recent: { entryCode: string; competitionSlug: string; competitionNameTa: string; competitionNameEn: string; status: string; createdAt: string; updatedAt: string }[];
};

const RECENT = 10;
const count = (v: unknown): number => Number(v ?? 0);

export async function loadDashboard(db: Queryable, now: Date): Promise<Dashboard> {
  // Independent reads, issued together: the page waits for the slowest one, not the sum of all five.
  const [comp, byStatus, judges, recent, settings] = await Promise.all([
    db.query<{ total: unknown; active: unknown }>("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS active FROM events"),
    db.query<{ status: string; n: unknown }>("SELECT status, COUNT(*) AS n FROM submissions GROUP BY status"),
    db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM staff_users WHERE role = 'judge' AND active = 1"),
    db.query<{ entry_code: string; slug: string; name_ta: string; name_en: string; status: string; created_at: unknown; updated_at: unknown }>(
    `SELECT s.entry_code, e.slug, e.name_ta, e.name_en, s.status, s.created_at, s.updated_at
       FROM submissions s JOIN events e ON e.id = s.event_id ORDER BY s.created_at DESC, s.id DESC LIMIT ${RECENT}`,
    ),
    loadSettings(db),
  ]);
  const counts = new Map(byStatus.rows.map((r) => [r.status, count(r.n)]));
  const n = (status: string) => counts.get(status) ?? 0;
  return {
    competitions: { total: count(comp.rows[0]?.total), active: count(comp.rows[0]?.active) },
    registrations: { total: [...counts.values()].reduce((a, b) => a + b, 0), draft: n("draft"), finalized: n("finalized"), held: n("held"), withdrawn: n("withdrawn"), rejected: n("rejected") },
    judges: { active: count(judges.rows[0]?.n) },
    registration: { open: registrationOpenAt(settings, now), opensAt: settings.opensAt?.toISOString() ?? null, closesAt: settings.closesAt?.toISOString() ?? null },
    recent: recent.rows.map((r) => ({
      entryCode: r.entry_code,
      competitionSlug: r.slug,
      competitionNameTa: r.name_ta,
      competitionNameEn: r.name_en,
      status: r.status,
      createdAt: asDate(r.created_at).toISOString(),
      updatedAt: asDate(r.updated_at).toISOString(),
    })),
  };
}
