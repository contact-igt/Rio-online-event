"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callApi, sessionCookieHeader } from "@/lib/api/express";
import { staffSession } from "@/lib/staff/auth";

// Approve or remove a winner. The Express API is the authority: it checks the session, the Administrator role, the CSRF token, that the entry
// is a finalized entry of this competition, that the place is free, and that results are not published yet; it writes the audit rows.
// These actions only forward the request and redirect back with a fixed ?notice= or ?error= code (never text).

const slugOk = (v: unknown): v is string => typeof v === "string" && v.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/u.test(v);
const back = (slug: string, params: Record<string, string>): never => {
  revalidatePath(`/admin/results/${slug}`);
  revalidatePath("/admin/results");
  redirect(`/admin/results/${slug}?${new URLSearchParams(params).toString()}`);
};

async function send(method: "POST" | "DELETE", path: string, body?: unknown): Promise<{ status: number; code?: string | undefined } | "signin"> {
  const session = await staffSession("admin");
  const cookie = await sessionCookieHeader();
  if (!session || !cookie) return "signin";
  const reply = await callApi<{ error?: { code?: string } }>(path, { method, cookie, csrf: session.csrfToken, ...(body === undefined ? {} : { body }) });
  return { status: reply.status, code: reply.apiCode };
}

const errorCode = (reply: { status: number; code?: string | undefined } | "signin"): string => {
  if (reply === "signin" || reply.status === 401 || reply.status === 403) return "forbidden";
  if (reply.status === 0 || reply.status >= 500) return "unavailable";
  if (reply.status === 400) return "invalid";
  return reply.code && /^[a-z_]{1,40}$/u.test(reply.code) ? reply.code : "other";
};

export async function approveWinnerAction(formData: FormData): Promise<void> {
  const slug = formData.get("slug");
  if (!slugOk(slug)) redirect("/admin/results");
  if (formData.get("confirm") !== "yes") back(slug, { error: "confirm_required" });
  const award = String(formData.get("awardLabel") ?? "").trim();
  const reply = await send("POST", `/admin/competitions/${slug}/winners`, {
    entryCode: String(formData.get("entryCode") ?? ""),
    place: Number(formData.get("place")),
    displayName: String(formData.get("displayName") ?? ""),
    awardLabel: award === "" ? null : award,
    confirm: true,
  });
  if (reply !== "signin" && reply.status === 201) back(slug, { notice: "approved" });
  back(slug, { error: errorCode(reply) });
}

export async function removeWinnerAction(formData: FormData): Promise<void> {
  const slug = formData.get("slug");
  const place = Number(formData.get("place"));
  if (!slugOk(slug)) redirect("/admin/results");
  if (!Number.isInteger(place) || place < 1 || place > 10) back(slug, { error: "invalid" });
  const reply = await send("DELETE", `/admin/competitions/${slug}/winners/${place}`);
  if (reply !== "signin" && reply.status === 200) back(slug, { notice: "removed" });
  back(slug, { error: errorCode(reply) });
}
