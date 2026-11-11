"use server";

import { revalidatePath } from "next/cache";
import { callApi, sessionCookieHeader } from "@/lib/api/express";
import { istInputToIso, type ApiSettings, type FormError } from "@/lib/event-settings/settings";
import { staffSession } from "@/lib/staff/auth";

// Saves the event settings through PATCH /admin/settings. The API is the authority: it checks the session, the Administrator role, the CSRF
// token and every rule. This action only converts the typed IST times and relays the API's answer. It cannot open registration: the API
// refuses any window that is already open.

export type SettingsState = { ok: true; settings: ApiSettings } | { ok: false; error: FormError; fields?: Record<string, string> } | undefined;

const text = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v : "");

export async function saveSettingsAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const session = await staffSession("admin");
  const cookie = await sessionCookieHeader();
  if (!session || !cookie) return { ok: false, error: "signin" };

  const dates = { opensAt: istInputToIso(text(formData.get("opensAt"))), closesAt: istInputToIso(text(formData.get("closesAt"))), resultsPublishAt: istInputToIso(text(formData.get("resultsPublishAt"))) };
  const badDates = Object.fromEntries(Object.entries(dates).filter(([, v]) => v === "invalid").map(([k]) => [k, "invalid_date"]));
  if (Object.keys(badDates).length > 0) return { ok: false, error: "invalid", fields: badDates };
  const version = text(formData.get("guardianConsentVersion")).trim();

  const reply = await callApi<ApiSettings & { error?: { code?: string; fields?: Record<string, string> } }>("/admin/settings", {
    method: "PATCH",
    body: { ...dates, guardianConsentVersion: version === "" ? null : version },
    cookie,
    csrf: session.csrfToken,
  });
  if (reply.status === 200 && reply.body) {
    revalidatePath("/admin");
    revalidatePath("/admin/settings");
    return { ok: true, settings: reply.body };
  }
  const code = reply.body?.error?.code;
  if (reply.status === 422 && code === "invalid_settings") return { ok: false, error: "invalid", fields: reply.body?.error?.fields ?? {} };
  if (reply.status === 400) return { ok: false, error: "invalid", fields: { guardianConsentVersion: "invalid_consent_version" } };
  if (reply.status === 409 && code === "results_already_published") return { ok: false, error: "published" };
  if (reply.status === 401 || reply.status === 403) return { ok: false, error: "forbidden" };
  return { ok: false, error: "unavailable" };
}
