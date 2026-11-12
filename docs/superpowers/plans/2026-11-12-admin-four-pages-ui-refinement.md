# RIO Admin Four-Page UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine Assign Judges, Scoring, Results, and Event Settings to match the approved RIO Admin visual system while preserving all existing API, auth, validation, and security behavior.

**Architecture:** Keep the existing server pages and client forms. Update page shells and presentation only, derive Assign Judges summary values from the two existing API responses, group the existing SettingsForm fields visually, and use a shared readiness component for the two genuinely unavailable workspaces. No backend or data-model changes.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS v4 utility classes, Vitest static layout tests.

**Spec:** `docs/superpowers/specs/2026-11-12-admin-four-pages-ui-design.md`

## Global Constraints

- “No backend, database, migration, environment, API, permission, or publication changes.”
- “No changes to the approved Registrations, Judges, Questions, sidebar, or global header experiences.”
- “No fabricated score, result, assignment, KPI, status, sorting, filtering, or publication controls.”
- “No new dependencies, commits, pushes, deployments, or production-record changes.”
- Preserve `requireStaff("admin")`, existing `assignJudge`, `saveSettingsAction`, field validation, IST handling, publication lock, and duplicate-submit protection.
- Verify only the affected layout/component tests, TypeScript, and production build; report unrelated pre-existing suite failures separately.

## Review Focus

- Judge list outage after competitions load: expect a distinct unavailable state, never a false “zero active judges” state. Test in Task 1.
- Empty competition list and empty active-judge list: expect honest empty states with no unusable assignment control. Test in Task 1.
- Scoring/Results capability absence: expect bilingual readiness messaging and no fake table, metrics, filters, or mutation controls. Test in Tasks 2–3.
- Settings field grouping: expect all four existing field names, one save action, and no changed action wiring or validation. Test in Task 4.
- Narrow/mobile layout: expect responsive grids and contained overflow only; no page-level overflow classes introduced. Test in each page task’s static assertions and build.

## File Map

- Modify `admin/app/admin/assign-judges/page.tsx`: shared page header, two supported summary metrics, honest load states, compact assignment workspace.
- Modify `admin/app/admin/scoring/page.tsx`: shared page shell and bilingual unavailable workspace; keep existing competition read and auth guard.
- Modify `admin/app/admin/results/page.tsx`: shared page shell and bilingual unavailable workspace; keep existing competition read and auth guard; do not add publication reads.
- Modify `admin/app/admin/settings/page.tsx`: shared page header and grouped settings workspace around the existing form.
- Modify `admin/components/admin/settings-form.tsx`: group the existing four fields without changing form state/action behavior.
- Modify `admin/components/admin/api-not-ready.tsx`: add the small presentation API needed for page-specific eyebrow, description, icon, and bilingual readiness copy.
- Create `admin/tests/admin-four-pages-ui.test.ts`: focused static regression coverage for page hierarchy, honest unavailable states, supported summary data, and settings field preservation.

### Task 1: Refine Assign Judges

**Files:**
- Modify: `admin/app/admin/assign-judges/page.tsx`
- Test: `admin/tests/admin-four-pages-ui.test.ts`

**Interfaces:**
- Consumes: `loadCompetitions(): Promise<Loaded<Competition[]>>`, `loadJudgesList(): Promise<Loaded<AdminJudgeRow[]>>`, and `AssignJudgeForm`.
- Produces: a responsive page with exactly two supported summary values (`competitions.data.length` and active-judge count), no invented assignment-status count, and a distinct judge-load error branch.

- [ ] **Step 1: Write the failing static tests**
  Add assertions that the page has the approved eyebrow/header classes, renders supported competition and active-judge summary labels, checks `judges.ok` before rendering assignment forms, and retains `AssignJudgeForm` plus `requireStaff("admin")`.

- [ ] **Step 2: Run the focused test and verify it fails**
  Run: `npm test -- --run tests/admin-four-pages-ui.test.ts`
  Expected: FAIL because the current page has no approved header/summary structure and treats a failed judge load as an empty judge list.

- [ ] **Step 3: Implement the minimal page refinement**
  Preserve both existing loads and the active-judge derivation. Add the shared-width bilingual header, two compact summary items, and a primary assignment card containing the existing per-competition forms. If competitions fail, keep the existing alert. If the judge load fails, show a clear unavailable alert and do not render assignment forms; if there are no active judges, show the existing empty state honestly.

- [ ] **Step 4: Run focused tests and verify they pass**
  Run: `npm test -- --run tests/admin-four-pages-ui.test.ts`
  Expected: PASS for the Assign Judges assertions.

### Task 2: Refine Scoring Readiness Workspace

**Files:**
- Modify: `admin/app/admin/scoring/page.tsx`
- Modify: `admin/components/admin/api-not-ready.tsx`
- Test: `admin/tests/admin-four-pages-ui.test.ts`

**Interfaces:**
- Consumes: existing `requireStaff("admin")` and `loadCompetitions()` guard/read behavior.
- Produces: a page-specific bilingual unavailable workspace with no fabricated score data or controls.

- [ ] **Step 1: Extend the failing static tests**
  Assert the Scoring page keeps the auth/data calls, uses the shared readiness component, names the scoring section bilingually, and contains no score/table/filter/publish implementation.

- [ ] **Step 2: Run the focused test and verify it fails**
  Run: `npm test -- --run tests/admin-four-pages-ui.test.ts`
  Expected: FAIL because the current page uses an oversized generic alert rather than the approved page shell/readiness workspace.

- [ ] **Step 3: Implement the minimal shared readiness API and page shell**
  Add optional presentation props to `ApiNotReady` without changing its default semantics. Render the Scoring page with the approved eyebrow/header, one concise description, and the bilingual unavailable workspace. Keep the existing competition outage/empty branches and authorization behavior.

- [ ] **Step 4: Run focused tests and verify they pass**
  Run: `npm test -- --run tests/admin-four-pages-ui.test.ts`
  Expected: PASS for Scoring assertions.

### Task 3: Refine Results Readiness Workspace

**Files:**
- Modify: `admin/app/admin/results/page.tsx`
- Test: `admin/tests/admin-four-pages-ui.test.ts`

**Interfaces:**
- Consumes: the same `ApiNotReady` presentation API and existing `requireStaff("admin")`/`loadCompetitions()` behavior.
- Produces: a page-specific bilingual unavailable workspace that does not add a publication-status read or weaken the 14 November 2026, 00:00 IST publication gate.

- [ ] **Step 1: Extend the failing static tests**
  Assert the Results page keeps the auth/data calls, uses the shared readiness component with Results-specific copy, contains no fabricated results table/actions, and does not add `loadSettings`, publication mutation, or publication-status reads.

- [ ] **Step 2: Run the focused test and verify it fails**
  Run: `npm test -- --run tests/admin-four-pages-ui.test.ts`
  Expected: FAIL because the current page uses the old generic unavailable alert and lacks the approved page hierarchy.

- [ ] **Step 3: Implement the minimal Results page refinement**
  Render the approved bilingual header and the shared readiness workspace. Keep the existing competition failure/empty states and avoid any new API call or result action.

- [ ] **Step 4: Run focused tests and verify they pass**
  Run: `npm test -- --run tests/admin-four-pages-ui.test.ts`
  Expected: PASS for Results assertions.

### Task 4: Refine Event Settings Grouping

**Files:**
- Modify: `admin/app/admin/settings/page.tsx`
- Modify: `admin/components/admin/settings-form.tsx`
- Test: `admin/tests/admin-four-pages-ui.test.ts`

**Interfaces:**
- Consumes: `SettingsForm`, `ApiSettings`, `istMinuteNow`, `saveSettingsAction`, and the existing four field names.
- Produces: a grouped responsive settings workspace with one unchanged save action and all existing validation/state behavior intact.

- [ ] **Step 1: Extend the failing static tests**
  Assert the page has the approved header and section labels for Registration, Consent, and Results; the form retains `saveSettingsAction`, all four existing field names, one save button, and responsive grid classes.

- [ ] **Step 2: Run the focused test and verify it fails**
  Run: `npm test -- --run tests/admin-four-pages-ui.test.ts`
  Expected: FAIL because the current form renders one long undivided list and the page has the older header/card shell.

- [ ] **Step 3: Implement the minimal grouped layout**
  Keep `useActionState`, controlled `values`, field-error mapping, `openMin`, and the existing `SubmitButton`. Replace only the flat field map presentation with three labeled sections: Registration (`opensAt`, `closesAt`), Consent (`guardianConsentVersion`), and Results (`resultsPublishAt`). Use a responsive two-column grid for fields where appropriate, stack on small screens, and keep one save button at the end.

- [ ] **Step 4: Run focused tests and verify they pass**
  Run: `npm test -- --run tests/admin-four-pages-ui.test.ts`
  Expected: PASS for Settings assertions.

### Final Verification

- [ ] Run: `npm test -- --run tests/admin-four-pages-ui.test.ts tests/judges-layout.test.ts tests/registrations-layout.test.ts tests/questions-layout.test.ts`
  Expected: affected layout tests pass; any unrelated pre-existing failures are reported, not repaired in this scope.
- [ ] Run: `npm run typecheck`
  Expected: exit 0.
- [ ] Run: `npm run build`
  Expected: Next production build exits 0 without changing backend behavior.
- [ ] Run: `git diff --check` and inspect changed paths
  Expected: no whitespace errors and only the four pages, shared readiness/settings presentation, focused test, and approved design/plan docs are changed.
