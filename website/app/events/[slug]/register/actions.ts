"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { registerPath } from "@/lib/auth/paths";
import { getEvent } from "@/lib/events";
import { currentRegistration, createRegistration, publicSettings, recoverRegistration, updateRegistration } from "@/lib/registration/express";
import { reg, type Msg } from "@/lib/registration/messages";
import { parseEventSlug } from "@/lib/auth/schemas";
import { normalizeMobile } from "@/lib/registration/schemas";

export type SaveState = { error?: Msg; fieldErrors?: Partial<Record<string, Msg>>; duplicateId?: string; values?: Record<string, string>; recoveryCode?: string } | undefined;

const noticeCookie = "rio_recovery_notice";

const problemMessage = (field: string, problem: string): Msg => {
  if (field === "childName" || field === "guardianName") return reg.errors.name;
  if (field === "childAge") return reg.errors.age;
  if (field === "guardianMobile") return reg.errors.mobile;
  if (field === "guardianConsent") return reg.errors.consent;
  if (problem === "registration_closed") return reg.errors.closed;
  if (problem === "consent_version_changed") return reg.errors.consentChanged;
  if (problem === "invalid_mobile") return reg.errors.mobile;
  return reg.errors.fix;
};

function rawValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ["childName", "childAge", "guardianName", "guardianMobile", "guardianEmail"]) {
    const value = formData.get(key);
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

function answersFrom(formData: FormData): Record<string, string | number | string[] | null> {
  const answers: Record<string, string | number | string[] | null> = {};
  for (const [key] of formData.entries()) {
    if (!key.startsWith("answer_")) continue;
    const questionKey = key.slice("answer_".length);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(questionKey)) continue;
    const type = formData.get(`questionType_${questionKey}`);
    const all = formData.getAll(key).filter((item): item is string => typeof item === "string");
    if (type === "checkboxes") answers[questionKey] = all;
    else if (type === "number") answers[questionKey] = all[0]?.trim() === "" ? null : Number(all[0]);
    else answers[questionKey] = all[0] ?? null;
  }
  return answers;
}

function consentBody(formData: FormData, settings: Awaited<ReturnType<typeof publicSettings>>) {
  const guardianVersion = settings?.guardianConsentVersion;
  if (!guardianVersion) return null;
  const mediaVersion = settings?.mediaConsentVersion;
  const mediaValue = formData.get("mediaConsent") === "on";
  return {
    guardianConsent: { accepted: formData.get("guardianConsent") === "on", version: guardianVersion },
    mediaConsent: mediaVersion ? { granted: mediaValue, version: mediaVersion } : null,
  };
}

export async function saveDraft(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const raw = rawValues(formData);
  const slug = parseEventSlug(String(formData.get("event") ?? ""));
  const event = slug ? getEvent(slug) : undefined;
  if (!event) return { error: reg.errors.notFound, values: raw };
  const settings = await publicSettings();
  if (!settings) return { error: reg.errors.unavailable, values: raw };
  if (!settings.registrationOpen) return { error: reg.errors.closed, values: raw };
  const consent = consentBody(formData, settings);
  if (!consent) return { error: reg.errors.closed, values: raw };
  const guardianMobile = normalizeMobile(raw.guardianMobile ?? "");
  if (!guardianMobile) return { error: reg.errors.mobile, values: raw };
  const draftId = String(formData.get("draftId") ?? "");
  const answers = answersFrom(formData);
  const body = {
    childName: raw.childName ?? "",
    childAge: Number(raw.childAge),
    guardianName: raw.guardianName ?? "",
    guardianMobile,
    guardianEmail: raw.guardianEmail?.trim() ? raw.guardianEmail.trim() : null,
    ...consent,
    ...(Object.keys(answers).length > 0 ? { answers } : {}),
    eventSlug: event.slug,
  };
  if (draftId) {
    const current = await currentRegistration();
    if (!current || current.view.status !== "draft") return { error: reg.errors.notFound, values: raw };
    const patch = {
      childName: body.childName,
      childAge: body.childAge,
      guardianName: body.guardianName,
      guardianMobile: body.guardianMobile,
      guardianEmail: body.guardianEmail,
      mediaConsent: body.mediaConsent,
      answers: body.answers,
      guardianConsent: formData.get("guardianConsent") === "on" ? consent.guardianConsent : undefined,
    };
    let result;
    try {
      result = await updateRegistration(patch, current.csrfToken);
    } catch {
      return { error: reg.errors.unavailable, values: raw };
    }
    if (result.status !== 200) return { error: problemMessage("form", result.fields?.[0]?.problem ?? "save_failed"), values: raw };
    redirect(`${registerPath(event.slug)}?saved=1`);
  }
  let result;
  try {
    result = await createRegistration(body);
  } catch {
    return { error: reg.errors.unavailable, values: raw };
  }
  if (result.status !== 201 || !result.body) return { error: problemMessage("form", result.fields?.[0]?.problem ?? "save_failed"), values: raw };
  const jar = await cookies();
  jar.set(noticeCookie, result.body.recoveryCode, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 300 });
  redirect(`${registerPath(event.slug)}?saved=1`);
}

export async function recoverDraft(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const slug = parseEventSlug(String(formData.get("event") ?? ""));
  if (!slug) return { error: reg.errors.notFound };
  const code = String(formData.get("recoveryCode") ?? "").trim();
  if (!code) return { error: reg.errors.notFound };
  let result;
  try {
    result = await recoverRegistration(code);
  } catch {
    return { error: reg.errors.unavailable };
  }
  if (result.status !== 200) return { error: reg.errors.notFound };
  redirect(registerPath(slug));
}

