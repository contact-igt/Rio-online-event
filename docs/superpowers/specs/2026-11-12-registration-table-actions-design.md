# Registration table actions design

## Intent

Add View, Edit, Copy Reference, and safe Delete actions to the existing Admin Registrations table without redesigning the approved page. Reuse the existing audited registration detail page for View, keep Copy entirely in the browser, and make Edit/Delete server-authorized operations.

## Scope and constraints

- View remains the existing `/admin/registrations/[entryCode]` page.
- Edit is limited to draft submissions and the existing editable child/guardian fields: child name, child age, guardian name, guardian mobile, and guardian email.
- Copy uses `navigator.clipboard` and never calls the backend.
- Delete is a transactional soft delete for drafts only; finalized, held, scored, approved, withdrawn, and rejected entries are protected.
- Existing filters, pagination, table columns, API authentication, CSRF, Origin checks, audit conventions, video ownership, and references remain intact.
- Existing migrations are not changed; new SQLite, MySQL, and MariaDB migrations are additive.

## Implementation approach

1. Add a compact client row-actions menu with outside-click, Escape, keyboard, and viewport-safe positioning. View is a link; Edit/Delete open independent dialogs; Copy gives short local feedback. Mutation options are rendered from the verified Admin page role, while the backend remains authoritative.
2. Add typed Admin API helpers and server actions. Server actions verify the staff session and role, preserve the existing cookie/CSRF forwarding, map 401/403/404/409/blocked errors distinctly, and revalidate the registrations list after successful mutations.
3. Add backend registration mutation routes under the existing Admin router. The service validates draft-only edits, competition age rules, existing normalization and duplicate constraints, and performs soft delete with an audit row in one transaction. Delete is idempotently blocked for non-draft or already deleted records and never removes video objects or related history.
4. Add `submissions.deleted_at` through additive migrations for all supported engines. Normal Admin list/detail, dashboard/recent counts, recovery/judging access, and submission mutation paths will exclude deleted records where those paths can otherwise expose or change an entry.

## Verification

Run only focused registration tests against disposable SQLite (and configured test MySQL/MariaDB if available), covering View, valid/invalid Edit, Copy UI behavior, draft soft delete/history/audit, protected statuses, RBAC, and cancel-no-mutation. Run the directly related Admin UI test and typecheck once. No production migration, live data mutation, or full-project audit.
