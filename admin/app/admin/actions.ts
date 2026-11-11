"use server";

import { assignJudgeApi } from "@/lib/admin/api";
import { staffSession } from "@/lib/staff/auth";
import type { WinnerResult } from "@/lib/judging/winners";

export type AssignResult = { ok: true; added: number } | { ok: false; code: "invalid" | "notAllowed" | "judgeNotFound" | "tooMany" | "unavailable" };

export async function assignJudge(input: { slug: string; judgeId: string }): Promise<AssignResult> {
  const session = await staffSession("admin");
  if (!session) return { ok: false, code: "notAllowed" };
  const reply = await assignJudgeApi(input.slug, input.judgeId, session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) {
    return { ok: true, added: reply.body.added };
  }
  if (reply.status === 404) {
    return { ok: false, code: "judgeNotFound" };
  }
  return { ok: false, code: "unavailable" };
}

export async function confirmWinnerAction(_input: { slug: string; submissionId: string; rank: string; displayName: string; awardLabel?: string; acknowledgeTie?: boolean }): Promise<WinnerResult> {
  return { ok: false, code: "unavailable" };
}

export async function removeWinnerAction(_input: { winnerId: string }): Promise<WinnerResult> {
  return { ok: false, code: "unavailable" };
}
