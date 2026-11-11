import { callApi, sessionCookieHeader } from "../api/express";
import type { Loaded } from "./api";
import type { Preview, SetDetail, SetList } from "../question-builder/types";

// Reads for the question builder, from the Express API. A missing competition (404) is reported separately from an outage.

export type QuestionsLoaded<T> = Loaded<T> | { ok: false; reason: "missing" };

async function get<T>(path: string): Promise<QuestionsLoaded<T>> {
  const cookie = await sessionCookieHeader();
  const reply = await callApi<T>(path, { cookie });
  if (reply.status === 200 && reply.body) return { ok: true, data: reply.body };
  if (reply.status === 404) return { ok: false, reason: "missing" };
  return { ok: false, reason: reply.status === 401 || reply.status === 403 ? "forbidden" : "unavailable" };
}

export const loadSetList = (slug: string) => get<SetList>(`/admin/competitions/${encodeURIComponent(slug)}/question-sets`);
export const loadSetDetail = (slug: string, setId: number) => get<SetDetail>(`/admin/competitions/${encodeURIComponent(slug)}/question-sets/${setId}`);
export const loadPreview = (slug: string, setId: number) => get<Preview>(`/admin/competitions/${encodeURIComponent(slug)}/question-sets/${setId}/preview`);
