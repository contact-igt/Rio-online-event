import { z } from "zod";

// Choosing a new password. The API enforces the real rules (backend/src/auth/password.ts passwordProblems, plus "not the current password");
// this only checks the shape first, and turns the API's reasons for refusing a password into the sentences the form shows.

export type SetPasswordCode = "invalid" | "mismatch" | "weak" | "current" | "tooMany" | "unavailable";

const input = z.object({ current: z.string().min(1).max(256), password: z.string().min(1).max(512), confirm: z.string().max(512) });

export function parsePasswordChange(raw: { current: unknown; password: unknown; confirm: unknown }): { currentPassword: string; newPassword: string } | SetPasswordCode {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return "invalid";
  if (parsed.data.password !== parsed.data.confirm) return "mismatch";
  return { currentPassword: parsed.data.current, newPassword: parsed.data.password };
}

export function passwordErrorCode(status: number, code: string | undefined): SetPasswordCode {
  if (status === 422 || code === "weak_password") return "weak";
  if (status === 403 && code === "current_password_incorrect") return "current";
  if (status === 429) return "tooMany";
  if (status === 400) return "invalid";
  return "unavailable";
}

/** The API's fixed reason labels (never the password itself), keyed to what the form says. */
export const WEAK_REASONS = {
  "shorter than 12 characters": "It is shorter than 12 characters.",
  "longer than 128 characters": "It is longer than 128 characters.",
  "too few different characters": "It uses fewer than 5 different characters.",
  "contains the e-mail name": "It contains the name part of your e-mail address.",
  "a commonly used password": "It is a commonly used password.",
  "starts or ends with a space": "It starts or ends with a space.",
  "same as the current password": "It is the same as your current password.",
} as const;
export type WeakReason = keyof typeof WEAK_REASONS;

/** Keeps only reasons this form knows, so nothing the API sends is shown verbatim. */
export function weakReasons(problems: unknown): WeakReason[] {
  return Array.isArray(problems) ? problems.filter((p): p is WeakReason => typeof p === "string" && Object.hasOwn(WEAK_REASONS, p)) : [];
}
