import { z } from "zod";
import { emailSchema } from "@/lib/auth/schemas";

// Staff sign-in answers, as the page shows them. The Express API checks the password and the role; this file only validates the shape of the
// input before it is sent and maps the API's answer to a code. Wrong password, unknown email and a deactivated account all come back
// from the API as the same 401, so the page cannot be used to learn which emails exist. Setup problems get their own codes, so a wrong or
// missing API address, or an API that refuses this site's origin, is not reported as "try again later".

export type LoginCode = "invalid" | "credentials" | "notStaff" | "tooMany" | "notConfigured" | "refused" | "unavailable";

const input = z.object({ email: emailSchema, password: z.string().min(1).max(256) });

export function parseLogin(raw: { email: unknown; password: unknown }): { email: string; password: string } | null {
  const parsed = input.safeParse({ email: raw.email, password: raw.password });
  return parsed.success ? parsed.data : null;
}

export function loginErrorCode(reply: { status: number; fault?: string | undefined; apiCode?: string | undefined }): LoginCode {
  const { status } = reply;
  if (reply.fault === "not_configured" || reply.fault === "invalid_config") return "notConfigured";
  if (status === 401) return "credentials";
  if (status === 429) return "tooMany";
  if (status === 400 || status === 422) return "invalid";
  if (status === 403 && reply.apiCode === "origin_not_allowed") return "refused";
  return "unavailable"; // API down (0), a missing route (404), a server error (5xx), anything unexpected; the reason is in the server log
}
