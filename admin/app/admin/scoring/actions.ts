"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { unlockScoreApi } from "@/lib/admin/api";
import { sessionCookieHeader } from "@/lib/api/express";
import { staffSession } from "@/lib/staff/auth";

const entryOk = (value: unknown): value is string => typeof value === "string" && /^[A-Z0-9]{6,16}$/u.test(value);
const judgeOk = (value: unknown): value is string => typeof value === "string" && /^JDG-[A-Z0-9]{1,16}$/u.test(value);

export async function unlockScoreAction(formData: FormData): Promise<void> {
  const entryCode = formData.get("entryCode");
  const judgeCode = formData.get("judgeCode");
  if (!entryOk(entryCode) || !judgeOk(judgeCode) || formData.get("confirm") !== "yes") redirect("/admin/scoring");

  const session = await staffSession("admin");
  const cookie = await sessionCookieHeader();
  if (!session || !cookie) redirect("/admin/scoring?error=forbidden");

  const reply = await unlockScoreApi(entryCode, judgeCode, session.csrfToken);
  if (reply.status === 200 && reply.body?.ok && typeof reply.body.slug === "string") {
    const target = `/admin/scoring/${reply.body.slug}`;
    revalidatePath(target);
    redirect(`${target}?notice=unlocked`);
  }
  if (reply.status === 404) redirect("/admin/scoring?error=score_not_found");
  if (reply.status === 409) redirect("/admin/scoring?error=score_not_final");
  if (reply.status === 401 || reply.status === 403) redirect("/admin/scoring?error=forbidden");
  redirect("/admin/scoring?error=unavailable");
}
