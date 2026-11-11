"use server";

import { provisionJudgeApi, resetJudgePasswordApi, setJudgeActiveApi } from "@/lib/admin/api";
import { staffSession } from "@/lib/staff/auth";
import type { InviteResult } from "@/lib/staff/invites";
import type { ProvisionResult, ResetResult } from "@/lib/staff/provisioning";

export async function inviteJudge(_input: { email: string; displayName: string }): Promise<InviteResult> {
  return { ok: false, code: "disabled" };
}

export async function provisionJudge(input: { email: string; displayName: string; emailVerified: boolean }): Promise<ProvisionResult> {
  const session = await staffSession("admin");
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
  const session = await staffSession("admin");
  if (!session) return { ok: false, code: "unavailable" };

  const reply = await resetJudgePasswordApi(input.judgeId, session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) {
    return {
      ok: true,
      password: reply.body.generatedPassword,
    };
  }
  if (reply.status === 404) {
    return { ok: false, code: "notFound" };
  }
  return { ok: false, code: "unavailable" };
}

export type ActiveResult = { ok: true } | { ok: false; code: "invalid" | "notAllowed" | "confirmRequired" | "notFound" | "tooMany" | "unavailable" };

export async function setJudgeActive(input: { judgeId: string; active: boolean; confirmed?: boolean }): Promise<ActiveResult> {
  const session = await staffSession("admin");
  if (!session) return { ok: false, code: "notAllowed" };

  if (!input.active && !input.confirmed) {
    return { ok: false, code: "confirmRequired" };
  }
  const reply = await setJudgeActiveApi(input.judgeId, input.active, session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) {
    return { ok: true };
  }
  if (reply.status === 404) {
    return { ok: false, code: "notFound" };
  }
  return { ok: false, code: "unavailable" };
}
