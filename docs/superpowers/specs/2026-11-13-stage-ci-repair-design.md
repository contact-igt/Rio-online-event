# Stage CI Repair Design

## Intent

Restore a green backend stage while preserving the current feature set. The active event catalog is four competitions, the schema contains 17 ordered migrations, and the existing scoring/results services are intended to be reachable through the admin API.

## Goals

- Mount the existing scoring, ranking, winners, and results-admin handlers through the admin router.
- Make guardian-consent activation fail closed: only explicitly deployed consent versions are accepted.
- Make development commands load `.env.development.local` consistently and provide the required placeholder-only backend `.env.example`.
- Align contradictory stale tests and command text with the current four-competition catalog and 17-migration schema.
- Verify the backend suite, build, typecheck, and lint as far as the repository permits.

## Non-goals

- Reverting the scoring/results, soft-delete, or migration features.
- Changing the active competition catalog or production secrets.
- Broad refactoring of the database or admin service layers.
- Adding new product behavior beyond the missing route wiring and fail-closed validation already specified by existing tests.

## Constraints

- Preserve the existing API shapes and authorization rules in the scoring/results modules.
- Keep consent validation exact and fail closed; historical rows are not revalidated.
- Keep test expectations tied to `website/lib/events.ts`, `backend/src/db/seed/competitions.ts`, and the migration files rather than duplicating withdrawn events.
- Development scripts must fail when `.env.development.local` is absent; production `start` must continue using platform environment variables only.
- Do not commit real credentials.

## Approaches

1. Repair the current stage in place (chosen): wire the existing handlers, correct the validator and scripts, add the missing example, and update stale assertions.
2. Revert the newer feature work: smaller short-term diff, but loses intended scoring/results and schema capabilities.
3. Patch runtime code only: leaves CI red because stale tests still encode withdrawn events and old migration counts.

The first approach is chosen because the current source and tests already contain the intended four-event/17-migration design; the failures are integration and synchronization defects rather than a reason to remove those features.

## Verification

Run the focused backend tests for routes, consent, scripts, migrations, and seed behavior first; then run the full backend test suite, typecheck, build, and lint. Any MySQL integration result will be reported separately from SQLite-only verification when the test database is unavailable.
