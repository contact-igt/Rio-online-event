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

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "unavailable" | "forbidden" | "not_found" };

async function get<T>(path: string): Promise<Loaded<T>> {
  const cookie = await sessionCookieHeader();
  const reply = await callApi<T>(path, { cookie });
  if (reply.status === 200 && reply.body) return { ok: true, data: reply.body };
  return { ok: false, reason: reply.status === 401 || reply.status === 403 ? "forbidden" : reply.status === 404 ? "not_found" : "unavailable" };
}

export type CompetitionSets = { id: number; version: number; questionCount: number };
export type Competition = { slug: string; nameTa: string; nameEn: string; published: CompetitionSets | null; draft: CompetitionSets | null };

export const loadCompetitions = async (): Promise<Loaded<Competition[]>> => {
  const loaded = await get<{ competitions: Competition[] }>("/admin/competitions");
  return loaded.ok ? { ok: true, data: loaded.data.competitions } : loaded;
};
export const loadDashboard = () => get<Dashboard>("/admin/dashboard");
export const loadSettings = () => get<ApiSettings>("/admin/settings");

export type RegistrationRow = {
  entryCode: string; status: string; competitionSlug: string; competitionNameTa: string; competitionNameEn: string; questionSetVersion: number;
  childName: string; childAge: number; guardianName: string; answered: number; openDuplicateFlag: boolean; createdAt: string; updatedAt: string;
};
export type RegistrationList = { registrations: RegistrationRow[]; total: number; page: number; pageSize: number };
export type RegistrationDetail = {
  entryCode: string; status: string; competition: { slug: string; nameTa: string; nameEn: string }; questionSetVersion: number;
  child: { name: string; age: number }; guardian: { name: string; mobile: string; email: string | null };
  consent: { guardian: { version: string | null; at: string | null }; media: { granted: boolean | null; version: string | null; at: string | null } };
  answers: { key: string; type: string; promptTa: string; promptEn: string; required: boolean; value: string | number | string[] | null; chosen: { ta: string; en: string }[] | null }[];
  duplicates: { status: string; reason: string; matchedEntryCode: string | null }[];
  createdAt: string; updatedAt: string;
};

export const loadRegistrations = (filter: { competition?: string; status?: string; page?: number }) => {
  const query = new URLSearchParams();
  if (filter.competition) query.set("competition", filter.competition);
  if (filter.status) query.set("status", filter.status);
  if (filter.page && filter.page > 1) query.set("page", String(filter.page));
  const text = query.toString();
  return get<RegistrationList>(`/admin/registrations${text ? `?${text}` : ""}`);
};
export const loadRegistration = async (entryCode: string): Promise<Loaded<RegistrationDetail>> => {
  const loaded = await get<{ registration: RegistrationDetail }>(`/admin/registrations/${encodeURIComponent(entryCode)}`);
  return loaded.ok ? { ok: true, data: loaded.data.registration } : loaded;
};
