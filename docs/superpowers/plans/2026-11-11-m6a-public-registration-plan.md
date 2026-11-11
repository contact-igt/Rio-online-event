# M6A Public Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the active public registration and recovery journey from Supabase to the existing Express registration API through a narrow same-origin Next.js gateway.

**Architecture:** Next.js server actions and route handlers call only an allowlisted local gateway. The gateway forwards fixed public registration paths to the configured Express origin, relays only the registration HttpOnly cookie and CSRF response header/token, and never accepts arbitrary upstream paths or URLs. The browser never sees recovery tokens or calls Express directly.

**Tech Stack:** Next.js App Router, TypeScript, Express registration API, Vitest, Playwright where executable.

**Spec:** M6A approval in the conversation.

## Global Constraints

- Keep registration closed; do not modify `rio_hospital`.
- Do not implement R2 uploads, finalization, e-mail, results, or admin/Judge auth changes.
- Preserve the existing Rio UI, typography, colors, Tamil copy, and responsive layout.
- Preserve HttpOnly recovery cookies; no localStorage tokens and no token URLs.
- Forward only allowlisted public endpoints and required headers.
- No Supabase fallback in the active registration flow.

## Review Focus

- Arbitrary path/URL input: gateway rejects it before upstream fetch.
- Cookie scope: only `rio_reg`/`__Host-rio_reg` is relayed; staff cookies never cross the gateway.
- CSRF and Origin: writes retain the trusted public Origin and Express CSRF header checks.
- Expired/foreign recovery: browser receives a generic recovery failure and no registration data.
- Closed registration: create/update paths remain blocked and no write is performed.

### Task 1: Gateway contract and tests

**Files:** Create `website/app/api/registration/[...path]/route.ts`; test alongside it.

- [ ] Write failing tests for allowlisted GET/POST/PATCH paths, rejected path traversal/admin paths, required Origin forwarding, cookie filtering, CSRF forwarding, and response cookie relay.
- [ ] Run the focused tests and confirm they fail for missing gateway behavior.
- [ ] Implement fixed path mapping for `/events`, `/settings/public`, `/registrations`, `/registrations/recover`, and `/registrations/current` only; use `RIO_API_ORIGIN` and a trusted `RIO_PUBLIC_ORIGIN`/request-origin check.
- [ ] Run focused gateway tests to green.

### Task 2: Server-only registration client

**Files:** Create `website/lib/registration/express.ts`; tests.

- [ ] Add typed helpers for public data, create, recover, read current, and patch current.
- [ ] Keep recovery credentials server-only and return sanitized fixed error codes to pages/actions.
- [ ] Add tests proving no Supabase imports/fallback and no token is returned to client code.

### Task 3: Replace active registration reads and writes

**Files:** Modify `website/app/events/[slug]/page.tsx`, registration page/actions/components, and related registration helpers.

- [ ] Replace Supabase event/settings/question loading with the Express client.
- [ ] Remove the active `requireParent`/OTP redirect from registration while leaving `/signin` and admin/Judge auth untouched.
- [ ] Map static fields, separate guardian/media consent, and published question answers to backend request shapes.
- [ ] Preserve existing UI and closed-state messaging.
- [ ] Add failing tests first for closed state, Tamil data, invalid mobile, question rendering, and recovery refresh.

### Task 4: Recovery-cookie flow

**Files:** Modify registration page/actions and add recovery UI/action tests.

- [ ] Create drafts through Express and rely on its HttpOnly cookie.
- [ ] Add code-entry recovery without putting the code in a URL or localStorage.
- [ ] Ensure refresh uses the cookie, and expired/foreign codes return generic errors.
- [ ] Verify CSRF token handling for updates.

### Task 5: Verification

- [ ] Run website lint, typecheck, tests, and build.
- [ ] Run relevant backend tests, typecheck, and build.
- [ ] Run isolated SQLite write-based browser tests if the environment permits.
- [ ] Report any Windows `spawn EPERM`, MariaDB/MySQL absence, or browser blockage as BLOCKED.
- [ ] Recheck Git status and confirm no staging, reset, commit, push, deployment, or database mutation.
