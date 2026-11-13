"use server";

import { redirect } from "next/navigation";
import { registerPath } from "@/lib/auth/paths";
import { getEvent } from "@/lib/events";
import { currentRegistration, createRegistration, publicEvents, publicSettings, recoverRegistration, updateRegistration, type PublicQuestion } from "@/lib/registration/express";
import { reg, type Msg } from "@/lib/registration/messages";
import { parseEventSlug } from "@/lib/auth/schemas";
import { normalizeMobile } from "@/lib/registration/schemas";

type Answers = Record<string, string | number | string[] | null>;
// `saved` means the details are stored (a new entry, or the open draft updated); the one-page form then goes on to the video and submission.
export type SaveState = { saved?: true; error?: Msg; fieldErrors?: Partial<Record<string, Msg>>; duplicateId?: string; values?: Record<string, string>; answers?: Answers } | undefined;

const problemMessage = (field: string, problem: string): Msg => {
  if (field === "childName" || field === "guardianName") return reg.errors.name;
  if (field.startsWith("answers.")) return reg.errors.answer;
  if (field === "childAge") return reg.errors.age;
  if (field === "guardianMobile") return reg.errors.mobile;
  if (field === "guardianConsent") return reg.errors.consent;
  if (problem === "registration_closed") return reg.errors.closed;
  if (problem === "consent_version_changed") return reg.errors.consentChanged;
  if (problem === "invalid_mobile") return reg.errors.mobile;
  return reg.errors.fix;
};

const formField: Record<string, string> = { childName: "childName", childAge: "childAge", guardianName: "parentName", guardianMobile: "mobile", guardianConsent: "guardianConsent" };

/** The API's field problems as messages under the form fields they belong to. An answer problem is shown under its question and also as the form-level message. */
function failure(result: { fields?: { field: string; problem: string }[] }, values: Record<string, string>, answers: Answers): SaveState {
  const fieldErrors: Partial<Record<string, Msg>> = {};
  let error: Msg | undefined;
  for (const { field: path, problem } of result.fields ?? []) {
    const field = path.split(".")[0] === "guardianConsent" ? "guardianConsent" : path; // the API names the consent problem "guardianConsent.accepted"
    const target = formField[field];
    if (target) fieldErrors[target] ??= problemMessage(field, problem);
    else if (field.startsWith("answers.")) {
      fieldErrors[`answer_${field.slice("answers.".length)}`] ??= reg.errors.answerInvalid;
      error ??= reg.errors.answer;
    } else error ??= problemMessage(field, problem);
  }
  return { error: error ?? (Object.keys(fieldErrors).length > 0 ? reg.errors.fix : problemMessage("form", "save_failed")), fieldErrors, values, answers };
}

const hasAnswer = (value: Answers[string] | undefined): boolean =>
  Array.isArray(value) ? value.length > 0 : typeof value === "number" ? Number.isFinite(value) : typeof value === "string" ? value.trim() !== "" : false;

/** Required questions without an answer. The questions come from the API (the set the entry is bound to), never from what the browser posted. */
function missingRequired(questions: readonly PublicQuestion[], answers: Answers): Partial<Record<string, Msg>> {
  const missing: Partial<Record<string, Msg>> = {};
  for (const q of questions) if (q.required && q.type !== "instruction" && !hasAnswer(answers[q.key])) missing[`answer_${q.key}`] = reg.errors.answerRequired;
  return missing;
}

function rawValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ["childName", "childAge", "parentName", "mobile", "guardianEmail"]) {
    const value = formData.get(key);
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

function answersFrom(formData: FormData): Answers {
  const answers: Answers = {};
  // Every rendered question posts its type, even when nothing was chosen, so an unticked checkbox group or radio still reaches the API as "no answer".
  for (const [typeKey] of formData.entries()) {
    if (!typeKey.startsWith("questionType_")) continue;
    const questionKey = typeKey.slice("questionType_".length);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(questionKey)) continue;
    const type = formData.get(typeKey);
    if (type === "instruction") continue;
    const all = formData.getAll(`answer_${questionKey}`).filter((item): item is string => typeof item === "string");
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
  const answers = answersFrom(formData);
  const guardianMobile = normalizeMobile(raw.mobile ?? "");
  if (!guardianMobile) return { error: reg.errors.fix, fieldErrors: { mobile: reg.errors.mobile }, values: raw, answers }; // under the mobile field, like every other field problem
  const draftId = String(formData.get("draftId") ?? "");
  // The question set an entry answers is fixed when it is created: an existing draft keeps its own version, a new one gets the one published now.
  const current = draftId ? await currentRegistration() : null;
  if (draftId && (!current || current.view.status !== "draft" || current.view.event.slug !== event.slug)) return { error: reg.errors.notFound, values: raw, answers };
  const questionSet = current ? current.view.questionSet : (await publicEvents())?.find((item) => item.slug === event.slug)?.questionSet;
  if (!questionSet) return { error: reg.errors.unavailable, values: raw, answers };
  const required = missingRequired(questionSet.questions, answers);
  if (Object.keys(required).length > 0) return { error: reg.errors.fix, fieldErrors: required, values: raw, answers };
  const body = {
    childName: raw.childName ?? "",
    childAge: Number(raw.childAge),
    guardianName: raw.parentName ?? "",
    guardianMobile,
    guardianEmail: raw.guardianEmail?.trim() ? raw.guardianEmail.trim() : null,
    ...consent,
    ...(Object.keys(answers).length > 0 ? { answers } : {}),
    eventSlug: event.slug,
  };
  if (current) {
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
    if (result.status !== 200) return failure(result, raw, answers);
    return { saved: true };
  }
  let result;
  try {
    result = await createRegistration(body);
  } catch {
    return { error: reg.errors.unavailable, values: raw, answers };
  }
  if (result.status !== 201 || !result.body) return failure(result, raw, answers);
  return { saved: true }; // the API set the registration cookie, so the video and the submission that follow open this entry
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

