"use server";

import { revalidatePath } from "next/cache";
import { deleteRegistrationApi, loadRegistration, purgeRegistrationApi, requestRegistrationPlaybackApi, restoreRegistrationApi, updateRegistrationApi, type RegistrationEditData } from "@/lib/admin/api";
import { staffSessionCheck } from "@/lib/staff/auth";

type ActionFailure = "sessionExpired" | "notAllowed" | "invalid" | "notFound" | "protected" | "conflict" | "unavailable";

const failure = (status: number, apiCode?: string): ActionFailure => {
  if (status === 401) return "sessionExpired";
  if (status === 403) return "notAllowed";
  if (status === 400 || status === 422) return "invalid";
  if (status === 404) return "notFound";
  if (apiCode === "registration_restore_conflict") return "conflict";
  if (status === 409 || apiCode === "registration_protected") return "protected";
  return "unavailable";
};

export type EditResult = { ok: true; data: RegistrationEditData & { entryCode: string; updatedAt: string } } | { ok: false; code: ActionFailure };

export type EditLoadResult = { ok: true; data: RegistrationEditData } | { ok: false; code: Exclude<ActionFailure, "invalid" | "protected"> };

export async function loadRegistrationForEdit(entryCode: string): Promise<EditLoadResult> {
  const checked = await staffSessionCheck("admin");
  if (!checked.ok) return { ok: false, code: checked.code === "notAllowed" ? "notAllowed" : checked.code };
  const reply = await loadRegistration(entryCode);
  if (!reply.ok) return { ok: false, code: reply.reason === "forbidden" ? "notAllowed" : reply.reason === "not_found" ? "notFound" : "unavailable" };
  if (reply.data.status !== "draft") return { ok: false, code: "notFound" };
  return { ok: true, data: { childName: reply.data.child.name, childAge: reply.data.child.age, guardianName: reply.data.guardian.name, guardianMobile: reply.data.guardian.mobile, guardianEmail: reply.data.guardian.email } };
}

export async function updateRegistration(entryCode: string, data: RegistrationEditData): Promise<EditResult> {
  const checked = await staffSessionCheck("admin");
  if (!checked.ok) return { ok: false, code: checked.code === "notAllowed" ? "notAllowed" : checked.code };
  const reply = await updateRegistrationApi(entryCode, data, checked.session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) {
    revalidatePath("/admin/registrations");
    revalidatePath(`/admin/registrations/${entryCode}`);
    return { ok: true, data: reply.body.registration };
  }
  return { ok: false, code: failure(reply.status, reply.apiCode) };
}

export type DeleteResult = { ok: true } | { ok: false; code: Exclude<ActionFailure, "invalid"> };

export async function deleteRegistration(entryCode: string): Promise<DeleteResult> {
  const checked = await staffSessionCheck("super_admin");
  if (!checked.ok) return { ok: false, code: checked.code === "notAllowed" ? "notAllowed" : checked.code };
  const reply = await deleteRegistrationApi(entryCode, checked.session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) {
    revalidatePath("/admin/registrations");
    revalidatePath(`/admin/registrations/${entryCode}`);
    return { ok: true };
  }
  return { ok: false, code: failure(reply.status, reply.apiCode) as DeleteResult extends { ok: false; code: infer C } ? C : never };
}

export type RestoreResult = { ok: true } | { ok: false; code: Exclude<ActionFailure, "invalid" | "notFound"> };

export async function restoreRegistration(entryCode: string): Promise<RestoreResult> {
  const checked = await staffSessionCheck("super_admin");
  if (!checked.ok) return { ok: false, code: checked.code === "notAllowed" ? "notAllowed" : checked.code };
  const reply = await restoreRegistrationApi(entryCode, checked.session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) {
    revalidatePath("/admin/registrations");
    revalidatePath("/admin/registrations");
    revalidatePath(`/admin/registrations/${entryCode}`);
    return { ok: true };
  }
  return { ok: false, code: failure(reply.status, reply.apiCode) as RestoreResult extends { ok: false; code: infer C } ? C : never };
}

export type PurgeResult = { ok: true } | { ok: false; code: "sessionExpired" | "notAllowed" | "notFound" | "protected" | "blocked" | "storage" | "unavailable" };

// Permanent delete. Super Admin only, checked here and again by the API, which also refuses anything but a soft-deleted draft.
export async function purgeRegistration(entryCode: string): Promise<PurgeResult> {
  const checked = await staffSessionCheck("super_admin");
  if (!checked.ok) return { ok: false, code: checked.code === "notAllowed" ? "notAllowed" : checked.code };
  const reply = await purgeRegistrationApi(entryCode, checked.session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) {
    revalidatePath("/admin/registrations/deleted");
    return { ok: true };
  }
  if (reply.status === 401) return { ok: false, code: "sessionExpired" };
  if (reply.status === 403) return { ok: false, code: "notAllowed" };
  if (reply.status === 404) return { ok: false, code: "notFound" };
  if (reply.status === 409) return { ok: false, code: reply.apiCode === "registration_purge_blocked" ? "blocked" : "protected" };
  if (reply.status === 502 || reply.status === 503) return { ok: false, code: "storage" };
  return { ok: false, code: "unavailable" };
}

export type VideoUrlResult = { ok: true; url: string; expiresInSeconds: number } | { ok: false; code: "sessionExpired" | "notAllowed" | "notFound" | "storage" | "unavailable" };

// The page never contains a video address. Pressing Play asks here; the API checks the role, writes an audit row and signs a link that lives five minutes.
export async function getRegistrationVideoUrl(entryCode: string): Promise<VideoUrlResult> {
  const checked = await staffSessionCheck("admin");
  if (!checked.ok) return { ok: false, code: checked.code === "notAllowed" ? "notAllowed" : checked.code === "sessionExpired" ? "sessionExpired" : "unavailable" };
  const reply = await requestRegistrationPlaybackApi(entryCode, checked.session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) return { ok: true, url: reply.body.url, expiresInSeconds: reply.body.expiresInSeconds };
  if (reply.status === 401) return { ok: false, code: "sessionExpired" };
  if (reply.status === 403) return { ok: false, code: "notAllowed" };
  if (reply.status === 404) return { ok: false, code: "notFound" };
  if (reply.status === 503) return { ok: false, code: "storage" };
  return { ok: false, code: "unavailable" };
}
