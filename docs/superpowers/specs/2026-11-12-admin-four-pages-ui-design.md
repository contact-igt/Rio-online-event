# RIO Admin Four-Page UI Refinement

## Intent

Bring `/admin/assign-judges`, `/admin/scoring`, `/admin/results`, and `/admin/settings` to the same compact, bilingual, production-ready visual standard already established by Registrations, Judges, and Questions, without changing business behavior.

## Goals

- Reuse the current RIO shell, tokens, typography, icons, cards, buttons, and responsive table patterns.
- Give every page the same page-header hierarchy: English eyebrow, Tamil heading, English label, and one concise description.
- Improve Assign Judges around the existing competition list, active-judge list, and `assignJudge` action.
- Improve Event Settings around the existing `SettingsForm` and `saveSettingsAction`, grouping the four existing fields by purpose without changing validation or save behavior.
- Give Scoring and Results a polished bilingual readiness workspace that clearly states the missing admin capability and performs no invented reads or writes.
- Keep the results publication gate, auth/RBAC, CSRF/origin checks, validation, and fail-closed behavior unchanged.

## Non-goals and anti-goals

- No backend, database, migration, environment, API, permission, or publication changes.
- No changes to the approved Registrations, Judges, Questions, sidebar, or global header experiences.
- No fabricated score, result, assignment, KPI, status, sorting, filtering, or publication controls.
- No new dependencies, commits, pushes, deployments, or production-record changes.

## Selected approach

Use UI-only refinement with minimal page/component edits. Assign Judges will keep the existing per-competition assignment action, but present it in a compact summary/workspace/table-like layout with only two real summary counts: total competitions and active judges. Competition-level assignment state and “unassigned” counts are not available from the current APIs, so they will not be displayed. If the judge list fails while competitions load, the page will show a distinct unavailable state rather than implying that zero judges exist. Scoring and Results will keep their current server-side capability checks and replace the large generic message with page-specific bilingual “Not available yet” content inside the shared page shell; Results will not add a publication-status read because no such admin read exists today, and neither page will expose disabled fake workflows.

Settings will retain one `SettingsForm` and one save action. The page will use a two-column desktop grouping for Registration, Consent, and Results settings, stacking on small screens. The form’s controlled values, server action, field errors, IST handling, publication lock, and save button remain the source of truth.

## Existing surfaces to reuse

- `admin/app/globals.css`: `.eyebrow`, `.card`, `.field`, `.btn`, and existing RIO color tokens.
- `admin/components/admin/assign-judge-form.tsx`: assignment action, duplicate-submit guard, and bilingual messages.
- `admin/components/admin/settings-form.tsx`: server action state, validation messages, controlled inputs, and save behavior.
- `admin/components/ui/icon.tsx`, `admin/lib/admin/api.ts`, and `admin/lib/staff/auth.ts`.
- Approved layout patterns in `admin/app/admin/judges/page.tsx`, `admin/app/admin/registrations/page.tsx`, and `admin/app/admin/questions/page.tsx`.

## Acceptance criteria

- All four pages share the approved width, header, spacing, card, button, and bilingual typography patterns.
- Assign Judges still calls the existing action, prevents repeated submits, and never invents assignment state.
- Settings still uses the existing action and validation; no setting is silently dropped or made editable beyond the current four fields.
- Scoring and Results clearly distinguish unavailable capability from empty data and do not fabricate data or actions.
- Results does not add a publication-status read; the existing publication gate remains backend-owned and untouched.
- Desktop, tablet, and mobile layouts avoid clipping and page-level horizontal overflow.
- Targeted route/layout tests, TypeScript, and the production build pass; broader pre-existing failures are reported separately.
