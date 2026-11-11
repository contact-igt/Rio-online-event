# RIO Full Structure & Integration Review Plan

> **For agentic workers:** execute inline; keep every check read-only unless a verified workflow blocker has a regression test.

**Goal:** Verify the active Admin → Express → MariaDB → Website registration workflow, fix only confirmed blockers, and report evidence and production readiness.

**Architecture:** Treat executable code and migrations as primary evidence, using docs as context. Trace question authoring, publication, delivery, answer validation and persistence; compare SQLite/MariaDB migration definitions and the deployed read-only status where guarded access permits.

**Tech Stack:** Next.js, TypeScript, Express, Kysely, MariaDB, SQLite, Cloudflare R2, Vitest, Playwright.

**Spec:** User request, “RIO — FULL STRUCTURE & INTEGRATION REVIEW” (2026-11-11).

## Global Constraints

- Do not modify Production data; only guarded, read-only Production checks are allowed.
- Do not drop/migrate Production, recreate migrations or Super Admin, commit, push or deploy.
- Preserve all pre-existing uncommitted work and branding/Tamil copy.
- Fix only proven Admin → Backend → Website registration blockers.
- Do not claim end-to-end success without successful end-to-end evidence.

## Review Focus

- Static and live schemas may differ across SQLite/MariaDB and migrations 0001–0013.
- Admin and website may use different active backends while stale Supabase code remains.
- Published question versions must remain immutable and submissions/answers bound to their exact version.
- Website draft/finalize/upload security must hold across API boundaries.
- Local tests/builds may not prove production runtime compatibility or real device upload behavior.

### Task 1: Capture current state and map active code

Read project instructions, Git status, app scripts/dependencies, route trees, migrations, and environment key names without exposing secrets. Record existing edits/untracked files.

### Task 2: Trace architecture and registration contracts

Trace Question Builder → API → DB → published questions → website form → answer validation/persistence. Verify auth, environment propagation, upload, consent, duplicate, draft/recovery, and finalization paths. Identify legacy and active Supabase references.

### Task 3: Verify schema and deployment evidence

Statically compare all 0001–0013 dialect definitions and expected entities/relations/constraints. Run only the guarded read-only Production status if safe credentials/configuration exist; do not run mutation commands. Note what cannot be verified.

### Task 4: Run scoped tests and fix confirmed blockers

Run tests/typechecks/lint/build/E2E that are safe and relevant. For each confirmed code defect, write and observe a failing regression test before the minimal fix; preserve existing work. Use only disposable test data.

### Task 5: Re-verify and report

Re-run affected checks, inspect final diff/status, and report architecture verdict, working components, issues with severity/root cause/fix/evidence, changed files, test results, remaining gaps, and production readiness.

