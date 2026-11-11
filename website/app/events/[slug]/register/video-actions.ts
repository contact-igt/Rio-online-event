"use server";

import { completeVideoUpload, currentRegistration, startVideoUpload } from "@/lib/registration/express";
import { codeFrom } from "@/lib/upload/api-codes";
import { checkFile, type UploadErrorCode } from "@/lib/upload/rules";

// Video upload for the entry the parent's recovery cookie opens. The Express API is the authority: it checks the cookie, the CSRF token,
// this site's Origin, the window, that the entry is a draft without a video, the type and the size, and later the stored object itself.
// These actions only forward the request and turn the answer into a code the screen can explain. No result contains an object key, a secret
// or any child detail. The upload URL in a result is a temporary credential for one object: it goes back only to the browser that asked.

export type Failure = { ok: false; code: UploadErrorCode };
export type Started = { ok: true; uploadId: string; url: string; contentType: string; expiresAt: string };
export type Finished = { ok: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The CSRF token for the entry the cookie opens, or null when there is none. */
async function csrf(): Promise<string | null> {
  return (await currentRegistration())?.csrfToken ?? null;
}

export async function requestVideoUpload(input: { type: string; bytes: number }): Promise<Started | Failure> {
  // The same cheap checks the browser made, so a hand-made call does not even reach the API.
  const problem = checkFile({ type: String(input?.type ?? ""), bytes: Number(input?.bytes) });
  if (problem) return { ok: false, code: problem };
  try {
    const token = await csrf();
    if (!token) return { ok: false, code: "notFound" };
    const reply = await startVideoUpload({ type: input.type, bytes: input.bytes }, token);
    if (reply.status === 201 && reply.body) return { ok: true, ...reply.body.upload };
    return { ok: false, code: codeFrom(reply) };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function confirmVideoUpload(input: { uploadId: string }): Promise<Finished | Failure> {
  const id = String(input?.uploadId ?? "");
  if (!UUID.test(id)) return { ok: false, code: "invalid" };
  try {
    const token = await csrf();
    if (!token) return { ok: false, code: "notFound" };
    const reply = await completeVideoUpload(id, token);
    if (reply.status === 200) return { ok: true };
    return { ok: false, code: codeFrom(reply) };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
