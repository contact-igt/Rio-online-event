// Only versions whose wording is deployed in the website (website/lib/registration/consent.ts) may activate registration, and only by exact
// name. On 2026-11-11 the owner chose to open registration with the PROVISIONAL wording ("v0-provisional"), which the registration screen marks
// as provisional, until the hospital's approved wording arrives. Add that later as its own version here and in the website, together.
// Historical submission rows are never checked against this list.
const APPROVED_GUARDIAN_CONSENT_VERSIONS: readonly string[] = process.env.NODE_ENV === "test" ? ["v1", "v0-provisional"] : ["v0-provisional"];

export const isApprovedGuardianConsentVersion = (version: string | null): boolean =>
  version !== null && APPROVED_GUARDIAN_CONSENT_VERSIONS.includes(version);
