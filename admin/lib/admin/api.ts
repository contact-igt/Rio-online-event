import { callApi, sessionCookieHeader } from "../api/express";
import type { ApiSettings } from "../event-settings/settings";

// Reads for the administrator screens, from the Express API. The API checks the session and the role itself; a refusal or an outage is
// reported as such and never replaced with made-up figures.

export type Dashboard = {
  competitions: { total: number; active: number };
  registrations: { total: number; draft: number; finalized: number; held: number; withdrawn: number; rejected: number };
  judges: { active: number };
  registration: { open: boolean; opensAt: string | null; closesAt: string | null };
  recent: { entryCode: string; competitionSlug: string; competitionNameTa: string; competitionNameEn: string; status: string; createdAt: string; updatedAt: string }[];
};

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "unavailable" | "forbidden" };

async function get<T>(path: string): Promise<Loaded<T>> {
  const cookie = await sessionCookieHeader();
  const reply = await callApi<T>(path, { cookie });
  if (reply.status === 200 && reply.body) return { ok: true, data: reply.body };
  return { ok: false, reason: reply.status === 401 || reply.status === 403 ? "forbidden" : "unavailable" };
}

export const loadDashboard = () => get<Dashboard>("/admin/dashboard");
export const loadSettings = () => get<ApiSettings>("/admin/settings");
