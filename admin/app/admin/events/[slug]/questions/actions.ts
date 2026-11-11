"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callApi, sessionCookieHeader } from "@/lib/api/express";
import { bodyOf, type FormModel, type Question } from "@/lib/question-builder/types";
import { staffSession } from "@/lib/staff/auth";

// Question builder actions. The Express API is the authority: it checks the session, the Administrator role, the CSRF token and every rule,
// and writes the audit rows. These actions only forward the request with the session's CSRF token and turn the answer into a message.
// Simple operations redirect back to the page with ?notice= or ?error= (a fixed code, never text); the question form returns its field errors.

type Reply<T = unknown> = { status: number; body: (T & { error?: { code?: string; fields?: Record<string, string> } }) | null };

const slugOk = (slug: unknown): slug is string => typeof slug === "string" && slug.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/u.test(slug);
const idOk = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0;
const base = (slug: string) => `/admin/events/${slug}/questions`;

async function send<T = unknown>(slug: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Reply<T> | "signin"> {
  const session = await staffSession("admin");
  const cookie = await sessionCookieHeader();
  if (!session || !cookie) return "signin";
  const reply = await callApi<T & { error?: { code?: string; fields?: Record<string, string> } }>(`/admin/competitions/${slug}/question-sets${path}`, { method, cookie, csrf: session.csrfToken, ...(body === undefined ? {} : { body }) });
  return { status: reply.status, body: reply.body };
}

function errorCode(reply: Reply | "signin"): string {
  if (reply === "signin") return "forbidden";
  const code = reply.body?.error?.code;
  if (reply.status === 0 || reply.status >= 500) return "unavailable";
  if (reply.status === 401 || reply.status === 403) return "forbidden";
  return code && /^[a-z_]{1,40}$/u.test(code) ? code : "other";
}

function back(slug: string, params: Record<string, string>): never {
  revalidatePath(base(slug));
  revalidatePath(`/admin/events/${slug}`);
  redirect(`${base(slug)}?${new URLSearchParams(params).toString()}`);
}

export async function createDraftAction(formData: FormData): Promise<void> {
  const slug = formData.get("slug");
  if (!slugOk(slug)) redirect("/admin");
  const startFrom = formData.get("startFrom") === "blank" ? "blank" : "published";
  const reply = await send(slug, "POST", "", { startFrom });
  if (reply !== "signin" && reply.status === 201) back(slug, { notice: "created" });
  back(slug, { error: errorCode(reply) });
}

export async function discardDraftAction(formData: FormData): Promise<void> {
  const slug = formData.get("slug");
  const setId = Number(formData.get("setId"));
  if (!slugOk(slug)) redirect("/admin");
  if (!idOk(setId)) back(slug, { error: "other" });
  const reply = await send(slug, "DELETE", `/${setId}`);
  if (reply !== "signin" && reply.status === 204) back(slug, { notice: "discarded" });
  back(slug, { error: errorCode(reply) });
}

export async function deleteQuestionAction(formData: FormData): Promise<void> {
  const slug = formData.get("slug");
  const setId = Number(formData.get("setId"));
  const questionId = Number(formData.get("questionId"));
  if (!slugOk(slug)) redirect("/admin");
  if (!idOk(setId) || !idOk(questionId)) back(slug, { error: "other" });
  const reply = await send(slug, "DELETE", `/${setId}/questions/${questionId}`);
  if (reply !== "signin" && reply.status === 204) back(slug, { notice: "deleted" });
  back(slug, { error: errorCode(reply) });
}

/** Moves one question a place. The new order is worked out here from the current list, then sent whole: the API accepts only an exact permutation. */
export async function moveQuestionAction(formData: FormData): Promise<void> {
  const slug = formData.get("slug");
  const setId = Number(formData.get("setId"));
  const questionId = Number(formData.get("questionId"));
  const by = formData.get("by") === "up" ? -1 : 1;
  if (!slugOk(slug)) redirect("/admin");
  if (!idOk(setId) || !idOk(questionId)) back(slug, { error: "other" });
  const current = await send<{ questions: Question[] }>(slug, "GET", `/${setId}`);
  if (current === "signin" || current.status !== 200 || !current.body) back(slug, { error: errorCode(current) });
  const ids = current.body.questions.map((q) => q.id);
  const at = ids.indexOf(questionId);
  const to = at + by;
  if (at < 0 || to < 0 || to >= ids.length) back(slug, {});
  [ids[at], ids[to]] = [ids[to]!, ids[at]!];
  const reply = await send(slug, "PUT", `/${setId}/order`, { order: ids });
  if (reply !== "signin" && reply.status === 200) back(slug, { notice: "moved" });
  back(slug, { error: errorCode(reply) });
}

export async function publishAction(formData: FormData): Promise<void> {
  const slug = formData.get("slug");
  const setId = Number(formData.get("setId"));
  if (!slugOk(slug)) redirect("/admin");
  if (!idOk(setId)) back(slug, { error: "other" });
  // The confirmation checkbox is checked again here, then the API requires confirm = true as well.
  if (formData.get("confirm") !== "yes") back(slug, { error: "other" });
  const reply = await send(slug, "POST", `/${setId}/publish`, { confirm: true });
  if (reply !== "signin" && reply.status === 200) back(slug, { notice: "published" });
  back(slug, { error: errorCode(reply) });
}

export type SaveState = { ok: false; error?: string; fields?: Record<string, string> } | undefined;

/** Add (no questionId) or update a question. On success it redirects to the list; on failure it returns the API's field codes. */
export async function saveQuestionAction(input: { slug: string; setId: number; questionId?: number; form: FormModel }): Promise<SaveState> {
  const { slug, setId, questionId, form } = input;
  if (!slugOk(slug) || !idOk(setId) || (questionId !== undefined && !idOk(questionId))) return { ok: false, error: "other" };
  const built = bodyOf(form);
  if (!built.ok) return { ok: false, fields: built.fields };
  const reply = questionId === undefined ? await send(slug, "POST", `/${setId}/questions`, built.body) : await send(slug, "PATCH", `/${setId}/questions/${questionId}`, built.body);
  if (reply !== "signin" && (reply.status === 201 || reply.status === 200)) back(slug, { notice: "saved" });
  const fields = reply !== "signin" && (reply.status === 422 || reply.status === 400) ? (reply.body?.error?.fields ?? {}) : undefined;
  return { ok: false, error: fields && Object.keys(fields).length > 0 ? "invalid" : errorCode(reply), ...(fields ? { fields } : {}) };
}
