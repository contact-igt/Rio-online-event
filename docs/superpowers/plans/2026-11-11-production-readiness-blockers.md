# Production Readiness Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent local commands from loading hosted credentials, restore safe backend environment documentation, and align stale Admin boundary tests with the M6A placeholder registration flow without touching production data.

**Architecture:** Local development and CLI commands load only `backend/.env.local`; Railway `start` continues to use runtime variables only. Migration SQL is not changed or applied; tests and static guards document MariaDB limitations and partial-DDL recovery. Admin boundary tests are updated to assert that upload/finalization code is absent from the current M6A page.

**Tech Stack:** Node 24, TypeScript, Express, Vitest, MariaDB/MySQL migration files, Next.js static boundary tests.

**Spec:** RIO production database readiness and super-admin bootstrap safety request.

## Global Constraints

- No production writes, migrations, seeding, resets, Docker, Supabase changes, commits, pushes, or deployment.
- Never print, overwrite, or delete credentials.
- Never use `rio_hospital` or a production database for destructive testing.
- SQLite results must not be represented as MariaDB compatibility evidence.

## Review Focus

- A local `.env` containing a hosted URL must not be loaded by development or CLI scripts.
- Production `start` must continue to read only Railway runtime variables.
- A failed MariaDB 0013 DDL sequence must be detected and documented as requiring manual recovery.
- Boundary tests must not reintroduce Supabase upload or submission paths.
- The restored `.env.example` must contain names and placeholders only.

### Task 1: Environment loading isolation

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/src/environment.test.ts`
- Create: `backend/.env.example`

- [ ] Add failing assertions that `dev`, `db:*`, and `staff:*` scripts load `.env.local` and never `.env`, while `start` remains env-file-free.
- [ ] Run the focused environment test and confirm failure against current `.env` scripts.
- [ ] Change scripts to `--env-file-if-exists=.env.local` only.
- [ ] Restore a placeholder-only `backend/.env.example` documenting local MariaDB, isolated tests, and Railway runtime variables.
- [ ] Run focused environment tests, lint, and typecheck.

### Task 2: Migration safety evidence

**Files:**
- Modify: `backend/src/db/migration-0013.test.ts`
- Modify: `backend/src/db/cli-setup.test.ts`
- Modify: `backend/migrations/README.md`

- [ ] Add tests/documentation proving SQLite coverage is not MariaDB coverage and that MariaDB/MySQL execution requires an explicitly configured isolated test database.
- [ ] Add static safety assertions documenting that 0013 is multi-statement non-transactional DDL and that partial failure requires operator inspection rather than silent retry.
- [ ] Do not alter applied migration SQL or add automatic retry behavior.
- [ ] Run available isolated tests; report MariaDB as BLOCKED when no matching test DB is configured.

### Task 3: M6A Admin boundary alignment

**Files:**
- Modify: `admin/tests/boundary.test.ts`

- [ ] Replace the two stale assertions requiring `uploadStep()` and `submitStep()` on the registration page.
- [ ] Assert that the current page contains the safe disabled/later-stage placeholder and does not import legacy upload/finalization modules.
- [ ] Run Admin lint, typecheck, tests, and build; classify Windows `spawn EPERM` as BLOCKED.

### Task 4: Verification and report

- [ ] Confirm `git status` and preserve all pre-existing changes.
- [ ] Run backend lint/typecheck/build and focused tests.
- [ ] Verify no command touched production or local databases.
- [ ] Produce the requested initialization runbook and explicit go/no-go recommendation.
