import { Router } from "express";
import type { DatabaseAdapter } from "../db/adapter.ts";
import { asDate } from "../db/values.ts";

// The public winners page's only data source. Anonymous, read-only, never cached. The database view `published_winners` is the authority: it
// returns rows only after an administrator has set a publication time that has passed. This code never publishes, never writes, and shows
// nothing the view did not return.
//   pending    nothing may be shown: not scheduled, scheduled for later, or no settings row
//   published  the view returned rows, or the publication time has passed and there are simply no confirmed winners

export type PublicWinner = { eventSlug: string; place: number; awardLabel: string | null; displayName: string };
export type PublicResults = { state: "pending" } | { state: "published"; winners: PublicWinner[] };

export async function loadPublicResults(db: DatabaseAdapter, now: Date): Promise<PublicResults> {
  const rows = (
    await db.query<{ event_slug: string; place: unknown; award_label: string | null; display_name: string }>(
      "SELECT w.event_slug, w.place, w.award_label, w.display_name FROM published_winners w JOIN events e ON e.id = w.event_id ORDER BY e.display_order, e.id, w.place, w.id",
    )
  ).rows;
  if (rows.length > 0) {
    return { state: "published", winners: rows.map((r) => ({ eventSlug: r.event_slug, place: Number(r.place), awardLabel: r.award_label, displayName: r.display_name })) };
  }
  const at = (await db.query<{ results_publish_at: unknown }>("SELECT results_publish_at FROM event_settings WHERE id = 1")).rows[0]?.results_publish_at;
  return at && asDate(at).getTime() <= now.getTime() ? { state: "published", winners: [] } : { state: "pending" };
}

export function resultsRouter(db: DatabaseAdapter, now: () => Date): Router {
  const router = Router();
  router.get("/results", async (_req, res, next) => {
    try {
      res.set("Cache-Control", "no-store").json(await loadPublicResults(db, now()));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
