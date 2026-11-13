import { callApi, sessionCookieHeader } from "../api/express";

export type JudgeAssignedEntry = {
  entryCode: string;
  competitionSlug: string;
  competitionNameTa: string;
  competitionNameEn: string;
  hasVideo: boolean;
  score: {
    marks: number | null;
    comments: string | null;
    status: "draft" | "final" | null;
    finalizedAt: string | null;
  } | null;
};

export type JudgeEntryDetail = {
  entryCode: string;
  competition: {
    slug: string;
    nameTa: string;
    nameEn: string;
  };
  hasVideo: boolean;
  // No answers: a judge scores the video by entry code only and never receives school, address, PIN or any personal detail.
  score: {
    marks: number | null;
    comments: string | null;
    status: "draft" | "final" | null;
    finalizedAt: string | null;
  } | null;
};

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "unavailable" | "forbidden" | "not_found" };

export async function loadJudgeEntries(): Promise<Loaded<JudgeAssignedEntry[]>> {
  const cookie = await sessionCookieHeader();
  const reply = await callApi<{ entries: JudgeAssignedEntry[] }>("/judge/entries", { cookie });
  if (reply.status === 200 && reply.body?.entries) {
    return { ok: true, data: reply.body.entries };
  }
  return { ok: false, reason: reply.status === 401 || reply.status === 403 ? "forbidden" : reply.status === 404 ? "not_found" : "unavailable" };
}

export async function loadJudgeEntryDetail(entryCode: string): Promise<Loaded<JudgeEntryDetail>> {
  const cookie = await sessionCookieHeader();
  const reply = await callApi<{ entry: JudgeEntryDetail }>(`/judge/entries/${encodeURIComponent(entryCode)}`, { cookie });
  if (reply.status === 200 && reply.body?.entry) {
    return { ok: true, data: reply.body.entry };
  }
  return { ok: false, reason: reply.status === 401 || reply.status === 403 ? "forbidden" : reply.status === 404 ? "not_found" : "unavailable" };
}

export async function requestPlaybackUrl(entryCode: string, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true; url: string; expiresInSeconds: number }>(`/judge/entries/${encodeURIComponent(entryCode)}/playback`, {
    method: "POST",
    cookie,
    csrf,
  });
}

export async function submitJudgeScore(entryCode: string, input: { marks: number | null; comments?: string; final: boolean }, csrf?: string) {
  const cookie = await sessionCookieHeader();
  return callApi<{ ok: true; status: "draft" | "final"; marks: number | null }>(`/judge/entries/${encodeURIComponent(entryCode)}/score`, {
    method: "PUT",
    body: input,
    cookie,
    csrf,
  });
}

