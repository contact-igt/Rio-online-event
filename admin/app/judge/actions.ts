"use server";

import { requestPlaybackUrl, submitJudgeScore } from "@/lib/judging/api";
import type { Playback } from "@/lib/judging/playback";
import type { ScoreResult } from "@/lib/judging/scoring";
import { staffSession } from "@/lib/staff/auth";

export async function getPlaybackUrl(input: { entryId: string }): Promise<Playback> {
  const session = await staffSession("judge");
  if (!session) return { ok: false, code: "unavailable" };

  const reply = await requestPlaybackUrl(input.entryId, session.csrfToken);
  if (reply.status === 200 && reply.body?.ok) {
    return {
      ok: true,
      url: reply.body.url,
      expiresInSeconds: reply.body.expiresInSeconds,
    };
  }
  if (reply.status === 404) {
    return { ok: false, code: "notFound" };
  }
  return { ok: false, code: "unavailable" };
}

export async function saveMyScore(input: { entryId: string; marks: string; comments: string; final: boolean }): Promise<ScoreResult> {
  const session = await staffSession("judge");
  if (!session) return { ok: false, code: "unavailable" };

  const trimmed = input.marks.trim();
  let marksNum: number | null = null;
  if (trimmed !== "") {
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      return { ok: false, code: "invalid" };
    }
    marksNum = Number(trimmed);
    if (marksNum < 0 || marksNum > 10) {
      return { ok: false, code: "invalid" };
    }
  }

  if (input.final && marksNum === null) {
    return { ok: false, code: "marksRequired" };
  }

  const reply = await submitJudgeScore(
    input.entryId,
    {
      marks: marksNum,
      comments: input.comments,
      final: input.final,
    },
    session.csrfToken,
  );

  if (reply.status === 200 && reply.body?.ok) {
    return {
      ok: true,
      status: reply.body.status,
    };
  }
  if (reply.status === 403) {
    return { ok: false, code: "locked" };
  }
  return { ok: false, code: "unavailable" };
}
