import { createHmac, randomInt } from "node:crypto";

// The two random strings a registration hands out.
//
//   recovery code   24 characters from Crockford's base32 (no I, L, O or U), 120 bits, shown to the parent in six groups of four. It is the
//                   ONLY way back into a draft: the same value rides in an HttpOnly cookie on the device that registered, and can be typed on
//                   another device. Only its SHA-256 is stored. A person's name or mobile number never opens anything.
//   entry reference a readable running number, RIO0001, RIO0002, ... (owner, 2026-11-13: "registration 1, registration 2"): the label that
//                   judges and administrators see instead of a child's name. It identifies, it does not authenticate (an entry opens only with the
//                   registration cookie). Entries made before this kept their random 10-character references; those use the alphabet below,
//                   which has no letter O, so they can never look like "RIO" followed by digits.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const random = (length: number): string => Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

export const newRecoveryCode = (): string => random(24);

export const ENTRY_PREFIX = "RIO";
const RUNNING = /^RIO(\d{4,})$/u;

/** The next running reference after the given existing ones: the highest RIO number plus one (plus `skip`, for a retry after a clash), at
 *  least four digits. Codes that are not RIO-and-digits (the older random ones, or anything else) are ignored. */
export function nextEntryReference(existing: readonly string[], skip = 0): string {
  let max = 0;
  for (const code of existing) {
    const m = RUNNING.exec(code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${ENTRY_PREFIX}${String(max + 1 + skip).padStart(4, "0")}`;
}

/** 4-4-4-4-4-4 for reading and typing. */
export const showRecoveryCode = (code: string): string => code.match(/.{4}/gu)!.join("-");

/** What a person typed or pasted, reduced to the stored form: separators dropped, letters upper-cased, the usual look-alikes mapped (O->0, I/L->1). Null if it cannot be a code. */
export function canonicalCode(typed: string): string | null {
  const text = typed
    .normalize("NFKC")
    .replace(/[\s-]/gu, "")
    .toUpperCase()
    .replace(/O/gu, "0")
    .replace(/[IL]/gu, "1");
  return /^[0-9A-HJKMNP-TV-Z]{24}$/.test(text) ? text : null;
}

/** The CSRF token of a registration cookie, derived from the code so no extra column is needed. Different label from the staff one, so the two can never be swapped. */
export const registrationCsrf = (code: string): string => createHmac("sha256", code).update("rio-registration-csrf-v1").digest("base64url");
