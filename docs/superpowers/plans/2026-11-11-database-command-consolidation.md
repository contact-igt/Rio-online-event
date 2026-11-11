# Database Command Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a single safe migration command, a read-only status command, and a development-only destructive reset command.

**Architecture:** Extend the existing database CLI rather than adding a second runner. Keep migration state and checksum decisions in `migrate.ts`; add a read-only schema inspector and a guarded reset preview/confirmation flow that is unavailable for production or remote targets.

**Tech Stack:** Node.js 24, TypeScript, Vitest, Kysely, mysql2, node:sqlite.

**Spec:** User-provided request: `RIO — SIMPLIFY DATABASE MIGRATION MANAGEMENT`.

## Global Constraints

- Preserve migrations 0001–0013 and existing worktree edits.
- Load `backend/.env` only for explicit npm CLI commands.
- Never execute production migrations or a database drop during this work.
- Do not alter schema from TypeScript definitions; drift is an error until a new migration is reviewed.
- No frontend, deployment, commit, push, or automatic migration changes.

## Review Focus

- A production or non-loopback target must be rejected before any destructive connection work.
- A failed confirmation must leave all application objects intact.
- Migration history without matching objects must be reported as drift, not repaired.
- Checksums and out-of-order history must stop migration before schema writes.
- Re-running migration must preserve existing rows and make no duplicate objects.

---

### Task 1: Consolidate migration and status commands

**Files:**
- Modify: `backend/src/db/cli.ts`, `backend/package.json`
- Modify: `backend/src/db/cli-commands.test.ts`, `backend/src/environment.test.ts`

- [ ] Write failing CLI tests for `migrate` reporting preflight/final status, applying pending migrations only, and rejecting unsafe history.
- [ ] Run the focused tests and observe the missing behavior.
- [ ] Make `migrate` run parity, history, schema preflight, the existing migration engine, and post-migration validation; make `status` read-only.
- [ ] Consolidate public npm scripts to `migrate`, `db:status`, and `db:drop`, each explicitly loading `.env`.
- [ ] Run focused CLI and environment tests.

### Task 2: Add read-only schema validation

**Files:**
- Create: `backend/src/db/schema-validation.ts`
- Create: `backend/src/db/schema-validation.test.ts`
- Modify: `backend/src/db/cli.ts`

- [ ] Write failing disposable-SQLite tests for missing migration table, unrecorded Rio objects, and migration-record/schema mismatch.
- [ ] Run the focused tests and observe failure.
- [ ] Implement catalogue inspection for expected migration tracking/application objects, returning fixed value-free drift identifiers.
- [ ] Invoke validation before and after `migrate` without auto-repairing any drift.
- [ ] Run focused tests.

### Task 3: Implement development-only drop command

**Files:**
- Modify: `backend/src/db/guards.ts`, `backend/src/db/reset.ts`, `backend/src/db/cli.ts`
- Create: `backend/src/db/drop-cli.test.ts`

- [ ] Write failing disposable-SQLite CLI tests for preview, non-interactive refusal, confirmation, object removal, and production/non-loopback rejection.
- [ ] Run the focused tests and observe failure.
- [ ] Add a development-disposable guard, a catalogue preview, and stdin confirmation; reuse dependency-safe drop logic without dropping the database itself.
- [ ] Run focused tests.

### Task 4: Verify the consolidated interface

**Files:**
- Modify: directly related tests only if assertions need the approved final command names.

- [ ] Run the full backend lint, typecheck, test, and build commands.
- [ ] Review the diff against the spec and confirm no production migration or drop command ran.
