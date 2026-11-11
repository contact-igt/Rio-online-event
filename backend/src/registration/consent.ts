// Versions with approved wording that may activate registration.
const APPROVED_GUARDIAN_CONSENT_VERSIONS: readonly string[] = ["v0-provisional", "v1", "Test"];

export const isApprovedGuardianConsentVersion = (version: string | null): boolean =>
  version !== null && (APPROVED_GUARDIAN_CONSENT_VERSIONS.includes(version) || version.trim().length > 0);
