# Registration Table Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add View, Edit, Copy Reference, and draft-only soft Delete actions to the existing Admin Registrations table with backend-enforced RBAC and preserved history.

**Architecture:** Reuse the existing registration detail page for View. Add a client row-actions menu and separate Edit/Delete dialogs. Add typed server actions/API routes backed by a transactional registration service and additive `deleted_at` migrations for SQLite, MySQL, and MariaDB.

**Tech Stack:** Next.js App Router, React, TypeScript, Express, Zod, SQL migrations, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-registration-table-actions-design.md`

## Global Constraints

- Drafts only may be edited or soft-deleted.
- Finalized, held, scored, approved, withdrawn, rejected, and deleted records remain protected.
- View uses the existing detail page; Copy is browser-only; no private video object keys or URLs are exposed.
- Preserve filters, pagination, authentication, CSRF, Origin checks, audit history, and existing uncommitted work.
- Do not modify ENV files, running scripts, applied migrations, production data, or unrelated pages.

## Review Focus

- Deleted records must be absent from normal list/detail/recovery/judging access while their history remains.
- Draft edits must obey schema validation, competition age limits, and duplicate constraints.
- Non-Super-Admin mutation requests must return 403 even if UI controls are hidden.
- Concurrent delete/edit must not mutate a protected or already deleted record.
- Cancel and Copy must perform no backend mutation.

### Task 1: Backend registration mutations and soft-delete schema

**Files:** backend registration service/routes/tests; additive migrations for SQLite/MySQL/MariaDB.

- [ ] Add failing focused tests for draft edit, invalid/protected edit, Super Admin/Admin/Judge RBAC, transactional draft soft delete with audit/history preservation, hidden access, and protected statuses.
- [ ] Run only the focused registration action tests and confirm they fail for missing routes/schema.
- [ ] Add `deleted_at` migrations using the next available number without editing prior migrations; implement validated draft update and transactional soft delete with audit logging and guarded status/deleted checks.
- [ ] Exclude deleted submissions from normal registration list/detail and other directly reachable recovery/judging paths.
- [ ] Run the focused backend tests once and confirm pass.

### Task 2: Admin API/server actions and table menu/dialogs

**Files:** Admin registration API client/server actions, existing registrations page or a focused row-actions component, focused dialogs/messages/tests.

- [ ] Add failing focused UI/static tests for the three-dot menu, existing View link, Copy Reference, role-aware Delete visibility, separate dialogs, and error mapping.
- [ ] Implement typed API helpers and server actions with verified role/session forwarding and distinct validation/permission/conflict/protected errors.
- [ ] Add the compact menu and separate Edit/Delete dialogs; update local row state and pagination after mutations, keep Copy local, and preserve table layout.
- [ ] Run the focused Admin tests and typecheck once.

### Task 3: Final focused verification

- [ ] Review the diff for scope and migration parity.
- [ ] Report View/Edit/Copy/Delete, RBAC, migration, targeted tests, and blockers; do not commit, deploy, or run production migrations.
