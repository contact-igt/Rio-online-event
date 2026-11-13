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
  /** Whether the entry has its one checked video. Absent from an API that predates video upload. */
  hasVideo?: boolean;
};
export type RegistrationList = { registrations: RegistrationRow[]; total: number; page: number; pageSize: number };
export type DeletedRegistrationRow = {
  entryCode: string; status: string; competitionSlug: string; competitionNameTa: string; competitionNameEn: string;
  childName: string; childAge: number; guardianName: string; deletedAt: string; deletedBy: string | null;
};
export type DeletedRegistrationList = { registrations: DeletedRegistrationRow[]; total: number; page: number; pageSize: number };
export type RegistrationDetail = {
  entryCode: string; status: string; competition: { slug: string; nameTa: string; nameEn: string }; questionSetVersion: number;
  child: { name: string; age: number }; guardian: { name: string; mobile: string; email: string | null };
  consent: { guardian: { version: string | null; at: string | null }; media: { granted: boolean | null; version: string | null; at: string | null } };
  answers: { key: string; type: string; promptTa: string; promptEn: string; required: boolean; value: string | number | string[] | null; chosen: { ta: string; en: string }[] | null }[];
  duplicates: { status: string; reason: string; matchedEntryCode: string | null }[];
  /** The entry's one checked video, if any (never a storage key or URL). Absent from an API that predates video upload. */
  video?: { uploaded: boolean; bytes: number | null; contentType: string | null; uploadedAt: string | null };
  createdAt: string; updatedAt: string;
};

export const loadRegistrations = (filter: { competition?: string; status?: string; q?: string; sort?: string; video?: string; duplicate?: boolean; page?: number }) => {
  const query = new URLSearchParams();
  if (filter.q) query.set("q", filter.q);
  if (filter.sort) query.set("sort", filter.sort);
  if (filter.video) query.set("video", filter.video);
  if (filter.duplicate) query.set("duplicate", "1");
  if (filter.competition) query.set("competition", filter.competition);
  if (filter.status) query.set("status", filter.status);
  if (filter.page && filter.page > 1) query.set("page", String(filter.page));
  const text = query.toString();
  return get<RegistrationList>(`/admin/registrations${text ? `?${text}` : ""}`);
};
export const loadDeletedRegistrations = (filter: { q?: string; page?: number }) => {
  const query = new URLSearchParams();
  if (filter.q) query.set("q", filter.q);
  if (filter.page && filter.page > 1) query.set("page", String(filter.page));
  const text = query.toString();
  return get<DeletedRegistrationList>(`/admin/registrations/deleted${text ? `?${text}` : ""}`);
};
export const loadRegistration = async (entryCode: string): Promise<Loaded<RegistrationDetail>> => {
  const loaded = await get<{ registration: RegistrationDetail }>(`/admin/registrations/${encodeURIComponent(entryCode)}`);
  return loaded.ok ? { ok: true, data: loaded.data.registration } : loaded;
};

export type RegistrationEditData = {
  childName: string;
  childAge: number;
  guardianName: string;
  guardianMobile: string;
  guardianEmail: string | null;
};

export async function updateRegistrationApi(entryCode: string, data: RegistrationEditData, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true; registration: RegistrationEditData & { entryCode: string; updatedAt: string } }>(`/admin/registrations/${encodeURIComponent(entryCode)}`, {
    method: "PATCH",
    body: data,
    cookie,
    csrf,
  });
}

export async function deleteRegistrationApi(entryCode: string, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true }>(`/admin/registrations/${encodeURIComponent(entryCode)}`, { method: "DELETE", cookie, csrf });
}

export async function restoreRegistrationApi(entryCode: string, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true }>(`/admin/registrations/${encodeURIComponent(entryCode)}/restore`, { method: "POST", cookie, csrf });
}

export type AdminJudgeRow = {
  id: number;
  name: string;
  email: string;
  judgeCode: string;
  active: boolean;
  mustChangePassword: boolean;
  assigned: number;
  drafts: number;
  final: number;
  progress: number | null;
  lastLoginAt: string | null;
  createdAt: string;
};

export const loadJudgesList = async (): Promise<Loaded<AdminJudgeRow[]>> => {
  const loaded = await get<{ judges: AdminJudgeRow[] }>("/admin/judges");
  return loaded.ok ? { ok: true, data: loaded.data.judges } : loaded;
};

export async function provisionJudgeApi(data: { email: string; displayName: string }, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true; id: number; email: string; displayName: string; judgeCode: string; generatedPassword: string }>("/admin/judges", {
    method: "POST",
    body: data,
    cookie,
    csrf,
  });
}

export async function setJudgeActiveApi(judgeId: number | string, active: boolean, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true }>(`/admin/judges/${judgeId}/active`, {
    method: "PATCH",
    body: { active },
    cookie,
    csrf,
  });
}

export async function resetJudgePasswordApi(judgeId: number | string, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true; generatedPassword: string }>(`/admin/judges/${judgeId}/reset-password`, {
    method: "POST",
    cookie,
    csrf,
  });
}

export async function assignJudgeApi(slug: string, judgeId: number | string, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true; added: number }>(`/admin/competitions/${encodeURIComponent(slug)}/assign-judge`, {
    method: "POST",
    body: { judgeId: Number(judgeId) },
    cookie,
    csrf,
  });
}


export async function updateJudgeApi(judgeId: number | string, data: { email: string; displayName: string }, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true; name: string; email: string }>(`/admin/judges/${judgeId}`, { method: "PATCH", body: data, cookie, csrf });
}

export async function deleteJudgeApi(judgeId: number | string, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true }>(`/admin/judges/${judgeId}`, { method: "DELETE", cookie, csrf });
}

export async function purgeRegistrationApi(entryCode: string, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true }>(`/admin/registrations/${encodeURIComponent(entryCode)}/permanent`, { method: "DELETE", cookie, csrf });
}

export type DeletedJudgeRow = { id: number; name: string; email: string; judgeCode: string; deletedAt: string };

export const loadDeletedJudges = async (): Promise<Loaded<DeletedJudgeRow[]>> => {
  const loaded = await get<{ judges: DeletedJudgeRow[] }>("/admin/judges/deleted");
  return loaded.ok ? { ok: true, data: loaded.data.judges } : loaded;
};

export async function restoreJudgeApi(judgeId: number | string, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true }>(`/admin/judges/${judgeId}/restore`, { method: "POST", cookie, csrf });
}

export async function purgeJudgeApi(judgeId: number | string, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true }>(`/admin/judges/${judgeId}/permanent`, { method: "DELETE", cookie, csrf });
}

export async function requestRegistrationPlaybackApi(entryCode: string, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true; url: string; expiresInSeconds: number }>(`/admin/registrations/${encodeURIComponent(entryCode)}/video/playback`, { method: "POST", cookie, csrf });
}

// ---- scoring (read only) ---------------------------------------------------------------------------------------------------------------
export type ScoringSummary = { submitted: number; ranked: number; waiting: number; notAssigned: number; ties: number; heldForReview: number };
export type ScoringOverview = { competitions: (ScoringSummary & { slug: string; nameTa: string; nameEn: string })[] };
export type JudgeMark = { judgeName: string; judgeCode: string; marks: number | null; comments?: string | null; status: "draft" | "final" | "none" };
export type RankingRow = {
  entryCode: string; childName: string; childAge: number; hasVideo: boolean; assigned: number; finalScores: number; drafts: number;
  complete: boolean; average: number | null; total?: number | null; maxTotal?: number; rank: number | null; tie: boolean; judges: JudgeMark[];
};
export type CompetitionRanking = { competition: { slug: string; nameTa: string; nameEn: string }; entries: RankingRow[]; summary: ScoringSummary };

export const loadScoringOverview = () => get<ScoringOverview>("/admin/scoring");
export const loadRanking = (slug: string) => get<CompetitionRanking>(`/admin/competitions/${encodeURIComponent(slug)}/ranking`);

// ---- results (winners chosen by hand; public only after the Event Settings time) --------------------------------------------------------
export type WinnerRow = { place: number; entryCode: string; childName: string; displayName: string; awardLabel: string | null; average: number | null; rank: number | null; approvedAt: string };
export type CompetitionWinners = { competition: { slug: string; nameTa: string; nameEn: string }; publishAt: string | null; frozen: boolean; winners: WinnerRow[]; candidates: RankingRow[] };
export type ResultsOverview = { publishAt: string | null; frozen: boolean; competitions: { slug: string; nameTa: string; nameEn: string; winners: number; finalized: number }[] };

export const loadResultsOverview = () => get<ResultsOverview>("/admin/results");
export const loadWinners = (slug: string) => get<CompetitionWinners>(`/admin/competitions/${encodeURIComponent(slug)}/winners`);
