import { z } from "zod";
import { classifyFetchError, logApiFault, resolveApiOrigin } from "@/lib/api/origin";
import { events } from "@/lib/events";

// The public winners page reads ONLY the Express API's anonymous GET /api/v1/results, with no session and no caching. The database is the
// authority: the API returns winners only when an administrator has set a publication time that has passed. This code never decides to
// publish, never writes, and never shows a row the API did not return or that is not well formed.

export type Winner = { eventSlug: string; rank: number; displayName: string; awardLabel: string | null };
export type ResultsState = { kind: "unavailable" } | { kind: "pending" } | { kind: "published"; winners: Winner[] };

const row = z.object({
  eventSlug: z.string(),
  place: z.number().int().min(1).max(10),
  displayName: z.string().trim().min(1).max(60),
  awardLabel: z.string().trim().max(80).nullable(),
});
const reply = z.union([z.object({ state: z.literal("pending") }), z.object({ state: z.literal("published"), winners: z.array(z.unknown()) })]);

/** Keeps only well-formed rows for known competitions, in competition order then rank. Anything else is dropped, not shown. */
export function toWinners(raw: unknown): Winner[] {
  if (!Array.isArray(raw)) return [];
  const order = new Map(events.map((e) => [e.slug, e.number]));
  const out: Winner[] = [];
  for (const item of raw) {
    const parsed = row.safeParse(item);
    if (parsed.success && order.has(parsed.data.eventSlug)) {
      out.push({ eventSlug: parsed.data.eventSlug, rank: parsed.data.place, displayName: parsed.data.displayName, awardLabel: parsed.data.awardLabel || null });
    }
  }
  return out.sort((a, b) => order.get(a.eventSlug)! - order.get(b.eventSlug)! || a.rank - b.rank);
}

/** pending: nothing may be shown. published: the API says the time has passed (with or without confirmed winners). Anything else: unavailable. */
export function toResults(raw: unknown): ResultsState {
  const parsed = reply.safeParse(raw);
  if (!parsed.success) return { kind: "unavailable" };
  return parsed.data.state === "pending" ? { kind: "pending" } : { kind: "published", winners: toWinners(parsed.data.winners) };
}

export async function loadResults(fetcher: typeof fetch = fetch): Promise<ResultsState> {
  const api = resolveApiOrigin();
  if (!api.ok) {
    logApiFault("website", { method: "GET", path: "/api/v1/results", host: null, status: 0, fault: api.fault, reason: api.reason });
    return { kind: "unavailable" };
  }
  try {
    const response = await fetcher(`${api.origin}/api/v1/results`, { cache: "no-store", redirect: "error", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) logApiFault("website", { method: "GET", path: "/api/v1/results", host: api.host, status: response.status });
    return response.ok ? toResults(await response.json()) : { kind: "unavailable" };
  } catch (error) {
    const { fault, cause } = classifyFetchError(error);
    logApiFault("website", { method: "GET", path: "/api/v1/results", host: api.host, status: 0, fault, cause });
    return { kind: "unavailable" };
  }
}
