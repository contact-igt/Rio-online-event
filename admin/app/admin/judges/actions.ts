"use server";

import { deleteJudgeApi, provisionJudgeApi, purgeJudgeApi, restoreJudgeApi, resetJudgePasswordApi, setJudgeActiveApi, updateJudgeApi } from "@/lib/admin/api";
import { staffSession, staffSessionCheck } from "@/lib/staff/auth";
import type { InviteResult } from "@/lib/staff/invites";
import type { ProvisionResult, ResetResult } from "@/lib/staff/provisioning";

export async function inviteJudge(_input: { email: string; displayName: string }): Promise<InviteResult> {
  return { ok: false, code: "disabled" };
}

export async function provisionJudge(input: { email: string; displayName: string; emailVerified: boolean }): Promise<ProvisionResult> {
  const session = await staffSession("super_admin");
  if (!session) return { ok: false, code: "notAllowed" };

  if (!input.emailVerified) {
    return { ok: false, code: "emailNotConfirmed" };
  }
  const reply = await provisionJudgeApi(
    {
      email: input.email,
      displayName: input.displayName,
    },
    session.csrfToken,
  );

  if (reply.status === 201 && reply.body?.ok) {
    return {
      ok: true,
      email: reply.body.email,
      password: reply.body.generatedPassword,
    };
  }

  if (reply.status === 409) {
    return { ok: false, code: "duplicate" };
  }
  if (reply.status === 429) {
    return { ok: false, code: "tooMany" };
  }
  return { ok: false, code: "provisionFailed" };
}

export async function resetJudgePassword(input: { judgeId: string }): Promise<ResetResult> {
  const checked = await staffSessionCheck("super_admin");
  if (!checked.ok) return { ok: false, code: checked.code };

  const reply = await resetJudgePasswordApi(input.judgeId, checked.session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) {
    return {
      ok: true,
      password: reply.body.generatedPassword,
    };
  }
  if (reply.status === 404) {
    return { ok: false, code: "notFound" };
  }
  if (reply.status === 401) return { ok: false, code: "sessionExpired" };
  if (reply.apiCode === "origin_not_allowed") return { ok: false, code: "originNotAllowed" };
  if (reply.status === 403) return { ok: false, code: "notAllowed" };
  if (reply.status === 429) return { ok: false, code: "tooMany" };
  if (reply.status === 0) return { ok: false, code: "connectionLost" };
  if (reply.status >= 500) return { ok: false, code: "serverError" };
  return { ok: false, code: "unavailable" };
}

export type ActiveResult = { ok: true } | { ok: false; code: "invalid" | "sessionExpired" | "notAllowed" | "originNotAllowed" | "confirmRequired" | "notFound" | "tooMany" | "unavailable" };

export async function setJudgeActive(input: { judgeId: string; active: boolean; confirmed?: boolean }): Promise<ActiveResult> {
  const checked = await staffSessionCheck("super_admin");
  if (!checked.ok) return { ok: false, code: checked.code };

  if (!input.active && !input.confirmed) {
    return { ok: false, code: "confirmRequired" };
  }
  const reply = await setJudgeActiveApi(input.judgeId, input.active, checked.session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) {
    return { ok: true };
  }
  if (reply.status === 404) {
    return { ok: false, code: "notFound" };
  }
  if (reply.status === 401) return { ok: false, code: "sessionExpired" };
  if (reply.apiCode === "origin_not_allowed") return { ok: false, code: "originNotAllowed" };
  if (reply.status === 403) return { ok: false, code: "notAllowed" };
  return { ok: false, code: "unavailable" };
}

// Editing and deleting a judge are for the Super Admin only; the API checks the role again.
export type EditResult = { ok: true; name: string; email: string } | { ok: false; code: "invalid" | "duplicate" | "sessionExpired" | "notAllowed" | "originNotAllowed" | "notFound" | "unavailable" };

export async function updateJudge(input: { judgeId: string; displayName: string; email: string }): Promise<EditResult> {
  const checked = await staffSessionCheck("super_admin");
  if (!checked.ok) return { ok: false, code: checked.code };
  const reply = await updateJudgeApi(input.judgeId, { displayName: input.displayName, email: input.email }, checked.session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) return { ok: true, name: reply.body.name, email: reply.body.email };
  if (reply.status === 400) return { ok: false, code: "invalid" };
  if (reply.status === 401) return { ok: false, code: "sessionExpired" };
  if (reply.apiCode === "origin_not_allowed") return { ok: false, code: "originNotAllowed" };
  if (reply.status === 403) return { ok: false, code: "notAllowed" };
  if (reply.status === 404) return { ok: false, code: "notFound" };
  if (reply.status === 409) return { ok: false, code: "duplicate" };
  return { ok: false, code: "unavailable" };
}

export type DeleteResult = { ok: true } | { ok: false; code: "sessionExpired" | "notAllowed" | "originNotAllowed" | "notFound" | "unavailable" };

export async function deleteJudge(input: { judgeId: string }): Promise<DeleteResult> {
  const checked = await staffSessionCheck("super_admin");
  if (!checked.ok) return { ok: false, code: checked.code };
  const reply = await deleteJudgeApi(input.judgeId, checked.session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) return { ok: true };
  if (reply.status === 401) return { ok: false, code: "sessionExpired" };
  if (reply.apiCode === "origin_not_allowed") return { ok: false, code: "originNotAllowed" };
  if (reply.status === 403) return { ok: false, code: "notAllowed" };
  if (reply.status === 404) return { ok: false, code: "notFound" };
  return { ok: false, code: "unavailable" };
}

export type DeletedJudgeResult = { ok: true } | { ok: false; code: "sessionExpired" | "notAllowed" | "originNotAllowed" | "notFound" | "blocked" | "unavailable" };

async function deletedJudgeAction(call: (csrf: string) => Promise<{ status: number; apiCode?: string | undefined }>): Promise<DeletedJudgeResult> {
  const checked = await staffSessionCheck("super_admin");
  if (!checked.ok) return { ok: false, code: checked.code };
  const reply = await call(checked.session.csrfToken);
  if (reply.status === 200) return { ok: true };
  if (reply.status === 401) return { ok: false, code: "sessionExpired" };
  if (reply.apiCode === "origin_not_allowed") return { ok: false, code: "originNotAllowed" };
  if (reply.status === 403) return { ok: false, code: "notAllowed" };
  if (reply.status === 404) return { ok: false, code: "notFound" };
  if (reply.status === 409) return { ok: false, code: "blocked" };
  return { ok: false, code: "unavailable" };
}

// Super Admin only (checked here and by the API): bring a soft-deleted judge back, or delete one for good when it left no history.
export async function restoreJudge(input: { judgeId: string }): Promise<DeletedJudgeResult> {
  return deletedJudgeAction((csrf) => restoreJudgeApi(input.judgeId, csrf));
}
export async function purgeJudge(input: { judgeId: string }): Promise<DeletedJudgeResult> {
  return deletedJudgeAction((csrf) => purgeJudgeApi(input.judgeId, csrf));
}
