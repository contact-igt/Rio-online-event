// Only versions with owner-approved wording may activate registration. This is deliberately empty until that wording
// is supplied and deployed to both backend and website. Historical submission rows are never checked against this list.
const APPROVED_GUARDIAN_CONSENT_VERSIONS: readonly string[] = process.env.NODE_ENV === "test" ? ["v1"] : [];

export const isApprovedGuardianConsentVersion = (version: string | null): boolean =>
  version !== null && APPROVED_GUARDIAN_CONSENT_VERSIONS.includes(version);
