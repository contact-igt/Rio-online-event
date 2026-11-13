# Stage CI Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the current backend stage pass while preserving the four-event, 17-migration feature set.

**Architecture:** Keep the existing scoring, winners, settings, migration, and seed services as the source of behavior. Repair only the missing admin-router integration, fail-open consent predicate, development environment scripts/example, and stale assertions that contradict the current source of truth.

**Tech Stack:** TypeScript, Express, Vitest, SQLite test database, Node package scripts.

**Spec:** `docs/superpowers/specs/2026-11-13-stage-ci-repair-design.md`

## Global Constraints

- Active competitions are the four entries in `website/lib/events.ts` and `backend/src/db/seed/competitions.ts`.
- All 17 migration files are ordered and must remain applied without renumbering or deletion.
- Consent activation accepts only explicit deployed versions; unknown non-empty strings must fail closed.
- Development scripts load `.env.development.local` strictly; `start` uses platform variables only.
- Never add real credentials.

## Review Focus

- Unknown consent labels must not open registration — covered by `backend/src/admin/settings.test.ts` and `backend/src/registration/registration.test.ts`.
- Scoring and winners routes must preserve admin-only authorization and existing service response shapes — covered by `backend/src/admin/scoring.test.ts`.
- Withdrawn competitions must not reappear through seed behavior — covered by `backend/src/db/seed-events.test.ts`.
- A migration count mismatch must not mask the real CLI/schema-drift behavior — covered by `backend/src/db/cli-commands.test.ts` and `backend/src/db/schema.test.ts`.
- Missing development env files must fail rather than silently load production settings — covered by `backend/src/environment.test.ts` and `backend/src/package-scripts.test.ts`.

### Task 1: Mount scoring and winners admin routes

**Files:**
- Modify: `backend/src/admin/routes.ts`
- Test: `backend/src/admin/scoring.test.ts`

**Interfaces:**
- Consumes: `loadRanking`, `scoringOverview`, `loadWinners`, `approveWinner`, `removeWinner`, `approveBody`.
- Produces: `GET /api/v1/admin/scoring`, `GET /api/v1/admin/competitions/:slug/ranking`, `GET|POST /api/v1/admin/competitions/:slug/winners`, and `DELETE /api/v1/admin/competitions/:slug/winners/:place`.

- [ ] **Step 1: Run the existing scoring test to verify the missing-route failure.**

  Run: `npm test -- src/admin/scoring.test.ts --reporter=verbose`

  Expected: route assertions fail with 404 while service-level ranking code is otherwise present.

- [ ] **Step 2: Add the minimal route wiring.**

  Import the scoring and winners service functions. Use the existing `admin` middleware for all read/write handlers, parse the slug through `slugOf`, parse the winner body through `approveBody`, parse the delete place with the existing numeric id parser or an equivalent positive integer check, and pass `actor(res)` plus `now()` to mutating services. Preserve existing error handling through `guarded`.

- [ ] **Step 3: Run the focused scoring test.**

  Run: `npm test -- src/admin/scoring.test.ts --reporter=verbose`

  Expected: the SQLite scoring tests pass.

### Task 2: Make consent validation fail closed

**Files:**
- Modify: `backend/src/registration/consent.ts`
- Test: existing `backend/src/admin/settings.test.ts`, `backend/src/registration/registration.test.ts`

**Interfaces:**
- Consumes: `isApprovedGuardianConsentVersion(version)`.
- Produces: exact membership behavior for deployed versions `v0-provisional` and `v1`; unknown labels, including `Test`, fail closed.

- [ ] **Step 1: Run the focused consent tests and observe the fail-open behavior.**

  Run: `npm test -- src/admin/settings.test.ts src/registration/registration.test.ts --reporter=verbose`

  Expected: unknown non-empty consent labels are accepted because the current predicate checks `version.trim().length > 0`.

- [ ] **Step 2: Replace the fail-open fallback with exact allow-list membership.**

- [ ] **Step 3: Re-run the focused consent tests.**

  Expected: all consent activation and public registration tests pass.

### Task 3: Repair development environment scripts and example

**Files:**
- Modify: `backend/package.json`
- Create: `backend/.env.example`
- Test: `backend/src/environment.test.ts`, `backend/src/package-scripts.test.ts`

**Interfaces:**
- Consumes: existing development and production npm scripts.
- Produces: strict `.env.development.local` loading for `dev` and all `*:dev` commands, plus a placeholder-only environment example containing the required local settings and Railway note.

- [ ] **Step 1: Run the focused script/environment tests.**

  Run: `npm test -- src/environment.test.ts src/package-scripts.test.ts --reporter=verbose`

  Expected: failures identify `dev`, `*:dev`, and the missing `backend/.env.example`.

- [ ] **Step 2: Update scripts without changing production startup.**

  Change `dev` and each `*:dev` command to use `node --env-file=.env.development.local`; leave non-dev CLI commands on `.env` and `start` as `node dist/server.js`.

- [ ] **Step 3: Add the placeholder-only `backend/.env.example`.**

  Include the exact required local MariaDB URL placeholder, `DB_ENGINE=mariadb`, and the statement that Railway production variables belong in Railway runtime settings; include no credentials.

- [ ] **Step 4: Re-run the focused script/environment tests.**

  Expected: all pass.

### Task 4: Align stale migration and seed assertions

**Files:**
- Modify: `backend/src/db/cli-commands.test.ts`
- Modify: `backend/src/db/schema.test.ts`
- Modify: `backend/src/db/seed-events.test.ts`

**Interfaces:**
- Consumes: current migration list and `COMPETITIONS` list.
- Produces: assertions that derive counts/messages from the current 17 migrations and four active competitions, while retaining conflict, idempotency, and schema-drift coverage.

- [ ] **Step 1: Update only contradictory literals.**

  Replace hard-coded old migration counts/messages with the current 17-migration expectation. Replace six-event poster assertions and withdrawn `tamilil-sollu` setup with four-event expectations and a missing active competition. Keep the tests’ all-or-nothing, organizer-preservation, audit, and idempotency assertions intact.

- [ ] **Step 2: Run the focused migration and seed tests.**

  Run: `npm test -- src/db/cli-commands.test.ts src/db/schema.test.ts src/db/seed-events.test.ts --reporter=verbose`

  Expected: all pass, including the intended schema-drift and out-of-order checks.

### Task 5: Full verification

**Files:**
- Verify: all backend files and tests.

- [ ] **Step 1: Run the full backend test suite.**

  Run: `npm test`

- [ ] **Step 2: Run typecheck, build, and lint.**

  Run: `npm run typecheck`; `npm run build`; `npm run lint`

- [ ] **Step 3: Review the diff and report any unavailable MySQL integration.**

  Run: `git diff --check`; `git status --short`.

