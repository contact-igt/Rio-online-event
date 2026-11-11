"use server";

import { currentRegistration, submitRegistration } from "@/lib/registration/express";
import { submitCodeFrom, type SubmitErrorCode } from "@/lib/submit/api-codes";

// Final submission of the entry the parent's registration cookie opens (owner, 2026-11-11: one sitting, details, then the video, then
// submit). The Express API is the authority: window, draft, consent, required answers, the one checked video and its length, and the
// duplicate hold. This action only forwards the request with the entry's CSRF token. No result contains an object key, a URL, a secret or
// any child detail, and whether the entry was finalized or held for review is not shown to the parent.

export type Submitted = { ok: true; already: boolean };
export type SubmitFailure = { ok: false; code: SubmitErrorCode };

export async function submitEntry(): Promise<Submitted | SubmitFailure> {
  try {
    const current = await currentRegistration();
    if (!current) return { ok: false, code: "notFound" };
    const already = current.view.status === "finalized" || current.view.status === "held";
    const reply = await submitRegistration(current.csrfToken);
    if (reply.status === 200) return { ok: true, already };
    return { ok: false, code: submitCodeFrom(reply) };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
