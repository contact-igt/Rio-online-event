import { z } from "zod";
import type { AuthConfig } from "../config.ts";
import type { DatabaseAdapter, Queryable } from "../db/adapter.ts";
import { DatabaseError } from "../db/errors.ts";
import { AppError } from "../http/errors.ts";
import { writeAudit } from "./audit.ts";
import { dummyHash, generatePassword, hashPassword, needsRehash, passwordProblems, verifyPassword } from "./password.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { isStaffRole } from "./roles.ts";
import { createSession, revokeAllSessions, revokeSessionByToken, type StaffRole, type StaffSession } from "./sessions.ts";

// Staff sign-in, password change and the account operations the command line needs. Plain functions over an explicit set of dependencies.
// Rules kept here:
//   * a wrong password, an unknown e-mail and a deactivated account all answer the same 401 and cost the same time (a dummy hash is verified);
//   * attempts are counted per IP address and per e-mail address in the shared database before the password is looked at, so a limited
//     caller learns nothing about whether the password was right;
//   * the role is never taken from the request; it is read from staff_users;
//   * every login, failed login (reason code only), logout and password change leaves an audit row without any secret or address in it.

export type AuthDeps = { db: DatabaseAdapter; auth: AuthConfig; now: () => Date; limiter: RateLimiter };
export const authDeps = (db: DatabaseAdapter, auth: AuthConfig, now: () => Date = () => new Date()): AuthDeps => ({ db, auth, now, limiter: createRateLimiter(db) });

export const LIMITS = {
  loginPerIp: { max: 30, windowMs: 15 * 60_000 },
  loginPerAccount: { max: 8, windowMs: 15 * 60_000 },
  passwordPerAccount: { max: 10, windowMs: 60 * 60_000 },
} as const;

export class RateLimited extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(429, "rate_limited", "Too many attempts. Try again later.");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const emailSchema = z.email().max(254).transform((e) => e.trim().toLowerCase());

export type PublicStaff = { id: number; email: string; displayName: string; role: StaffRole; mustChangePassword: boolean };
export const publicStaff = (s: Pick<StaffSession, "staffId" | "email" | "displayName" | "role" | "mustChangePassword">): PublicStaff => ({
  id: s.staffId,
  email: s.email,
  displayName: s.displayName,
  role: s.role,
  mustChangePassword: s.mustChangePassword,
});

type UserRow = { id: number | string; email: string; password_hash: string; role: string; display_name: string; active: number; must_change_password: number };
const invalidCredentials = () => new AppError(401, "invalid_credentials", "The e-mail or password is not correct.");

async function limit(deps: AuthDeps, scope: string, value: string, rule: { max: number; windowMs: number }, onFirstExcess: () => Promise<void>): Promise<void> {
  const { hits, retryAfterSeconds } = await deps.limiter.hit(scope, value, rule.windowMs, deps.now());
  if (hits > rule.max) {
    if (hits === rule.max + 1) await onFirstExcess(); // one audit row per window, so an attack cannot flood the log
    throw new RateLimited(retryAfterSeconds);
  }
}

export type LoginResult = { staff: PublicStaff; token: string; expiresAt: Date };

export async function login(deps: AuthDeps, input: { email: string; password: string; ip: string; requestId: string; previousToken?: string | null }): Promise<LoginResult> {
  const { db, auth } = deps;
  const email = input.email.trim().toLowerCase();
  const audit = (action: string, details: Record<string, string>, staffId: number | null = null) =>
    writeAudit(db, deps.now(), { actorType: "public", action, entityType: "staff_user", entityId: staffId, requestId: input.requestId, details });

  await limit(deps, "staff.login.ip", input.ip, LIMITS.loginPerIp, () => audit("staff.login_rate_limited", { scope: "ip" }));
  await limit(deps, "staff.login.account", email, LIMITS.loginPerAccount, () => audit("staff.login_rate_limited", { scope: "account" }));

  const user = (await db.query<UserRow>("SELECT id, email, password_hash, role, display_name, active, must_change_password FROM staff_users WHERE email = ?", [email])).rows[0];
  const correct = await verifyPassword(input.password, user ? user.password_hash : await dummyHash(auth.argon2));
  const usable = user !== undefined && correct && Number(user.active) === 1 && isStaffRole(user.role);
  if (!usable) {
    if (user) await db.query("UPDATE staff_users SET failed_logins = CASE WHEN failed_logins < 65535 THEN failed_logins + 1 ELSE failed_logins END WHERE id = ?", [Number(user.id)]).catch(() => undefined);
    await audit("staff.login_failed", { reason: !user ? "unknown_account" : !correct ? "bad_password" : "inactive" }, user ? Number(user.id) : null);
    throw invalidCredentials();
  }

  const now = deps.now();
  const upgraded = needsRehash(user.password_hash, auth.argon2) ? await hashPassword(input.password, auth.argon2) : null;
  const session = await db.transaction(async (tx) => {
    await tx.query("UPDATE staff_users SET failed_logins = 0, last_login_at = ?, password_hash = COALESCE(?, password_hash) WHERE id = ?", [now, upgraded, Number(user.id)]);
    if (input.previousToken) await revokeSessionByToken(tx, input.previousToken, now); // signing in again replaces the old session
    const created = await createSession(tx, Number(user.id), now, auth.sessionTtlMs);
    await writeAudit(tx, now, { actorType: "staff", actorStaffId: Number(user.id), action: "staff.login", entityType: "staff_user", entityId: Number(user.id), requestId: input.requestId });
    return created;
  });
  await deps.limiter.clear("staff.login.account", email);
  return {
    staff: { id: Number(user.id), email: user.email, displayName: user.display_name, role: user.role as StaffRole, mustChangePassword: Number(user.must_change_password) === 1 },
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

export async function logout(deps: AuthDeps, session: StaffSession, requestId: string): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    await tx.query("UPDATE staff_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [now, session.sessionId]);
    await writeAudit(tx, now, { actorType: "staff", actorStaffId: session.staffId, action: "staff.logout", entityType: "staff_user", entityId: session.staffId, requestId });
  });
}

export class WeakPassword extends AppError {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(422, "weak_password", "The new password is not acceptable.");
    this.problems = problems;
  }
}

/**
 * Changes the signed-in member's own password. Needs the current password (a stolen session alone is not enough), ends EVERY session of the
 * account, clears the first-login mark, and returns a fresh session for the caller. Counted per account so a stolen session cannot be used
 * to guess the current password.
 */
export async function changePassword(deps: AuthDeps, session: StaffSession, input: { currentPassword: string; newPassword: string; requestId: string }): Promise<LoginResult> {
  const { db, auth } = deps;
  await limit(deps, "staff.password", String(session.staffId), LIMITS.passwordPerAccount, () =>
    writeAudit(db, deps.now(), { actorType: "staff", actorStaffId: session.staffId, action: "staff.password_rate_limited", entityType: "staff_user", entityId: session.staffId, requestId: input.requestId }),
  );
  const row = (await db.query<{ password_hash: string }>("SELECT password_hash FROM staff_users WHERE id = ? AND active = 1", [session.staffId])).rows[0];
  if (!row || !(await verifyPassword(input.currentPassword, row.password_hash))) {
    await writeAudit(db, deps.now(), { actorType: "staff", actorStaffId: session.staffId, action: "staff.password_change_failed", entityType: "staff_user", entityId: session.staffId, requestId: input.requestId, details: { reason: "wrong_current_password" } });
    throw new AppError(403, "current_password_incorrect", "The current password is not correct.");
  }
  const problems = passwordProblems(input.newPassword, session.email);
  if (input.newPassword.normalize("NFKC") === input.currentPassword.normalize("NFKC")) problems.push("same as the current password");
  if (problems.length > 0) throw new WeakPassword(problems);

  const hash = await hashPassword(input.newPassword, auth.argon2);
  const now = deps.now();
  const created = await db.transaction(async (tx) => {
    await tx.query("UPDATE staff_users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?", [hash, now, session.staffId]);
    const closed = await revokeAllSessions(tx, session.staffId, now); // every device, including this one: the caller gets a new session below
    const next = await createSession(tx, session.staffId, now, auth.sessionTtlMs);
    await writeAudit(tx, now, { actorType: "staff", actorStaffId: session.staffId, action: "staff.password_changed", entityType: "staff_user", entityId: session.staffId, requestId: input.requestId, details: { sessions_ended: closed, first_login: session.mustChangePassword } });
    return next;
  });
  return { staff: { ...publicStaff(session), mustChangePassword: false }, token: created.token, expiresAt: created.expiresAt };
}

// ---- account operations without a web route (command line now, administrator screens in M5) -------------------------------------------------------

export type Actor = { type: "system" } | { type: "staff"; id: number };
const actorFields = (actor: Actor) => ({ actorType: actor.type, actorStaffId: actor.type === "staff" ? actor.id : null }) as const;

/** A Super Admin account can be changed by the system (the command line) or by another Super Admin, never by an ordinary administrator. */
async function assertMayManage(q: Queryable, actor: Actor, targetId: number): Promise<void> {
  const target = (await q.query<{ role: string }>("SELECT role FROM staff_users WHERE id = ?", [targetId])).rows[0];
  if (target?.role !== "super_admin" || actor.type === "system") return;
  const by = (await q.query<{ role: string }>("SELECT role FROM staff_users WHERE id = ? AND active = 1", [actor.id])).rows[0];
  if (by?.role !== "super_admin") throw new AppError(403, "forbidden", "You are not allowed to do this.");
}

/** Gives a member a new random temporary password, forces a change at the next sign-in and ends all their sessions. Returns the password once. */
export async function resetPassword(deps: AuthDeps, input: { staffId: number; actor: Actor; requestId?: string | null }): Promise<{ temporaryPassword: string }> {
  const temporaryPassword = generatePassword();
  const hash = await hashPassword(temporaryPassword, deps.auth.argon2);
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    await assertMayManage(tx, input.actor, input.staffId);
    const updated = await tx.query("UPDATE staff_users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?", [hash, input.staffId]);
    if (updated.affectedRows !== 1) throw new AppError(404, "not_found", "No such staff account.");
    const closed = await revokeAllSessions(tx, input.staffId, now);
    await writeAudit(tx, now, { ...actorFields(input.actor), action: "staff.password_reset", entityType: "staff_user", entityId: input.staffId, requestId: input.requestId ?? null, details: { sessions_ended: closed } });
  });
  return { temporaryPassword };
}

const adminInput = z.object({ email: emailSchema, displayName: z.string().trim().min(1).max(80) });

/** Creates an administrator with a random temporary password that must be changed at the first sign-in. Returns the password once. */
export async function createAdmin(deps: AuthDeps, raw: { email: string; displayName: string; actor: Actor }): Promise<{ id: number; temporaryPassword: string }> {
  const parsed = adminInput.safeParse({ email: raw.email, displayName: raw.displayName });
  if (!parsed.success) throw new AppError(400, "invalid_request", "The e-mail address or the name is not valid.");
  const temporaryPassword = generatePassword();
  const hash = await hashPassword(temporaryPassword, deps.auth.argon2);
  const now = deps.now();
  try {
    const id = await deps.db.transaction(async (tx) => {
      await tx.query("INSERT INTO staff_users (email, password_hash, role, display_name, active, must_change_password, created_at) VALUES (?, ?, 'admin', ?, 1, 1, ?)", [parsed.data.email, hash, parsed.data.displayName, now]);
      const created = Number((await tx.query<{ id: number | string }>("SELECT id FROM staff_users WHERE email = ?", [parsed.data.email])).rows[0]!.id);
      await writeAudit(tx, now, { ...actorFields(raw.actor), action: "staff.created", entityType: "staff_user", entityId: created, details: { role: "admin" } });
      return created;
    });
    return { id, temporaryPassword };
  } catch (error) {
    if (error instanceof DatabaseError && error.constraint === "unique") throw new AppError(409, "email_taken", "A staff account with this e-mail address already exists.");
    throw error;
  }
}

export const SUPER_ADMIN_DEFAULTS = { email: "riosuperadmin@gmail.com", displayName: "Rio Super Admin" } as const;

/**
 * Creates the Super Admin from a password the operator supplies (never generated here, never printed). Safe to repeat: an existing Super
 * Admin with that e-mail is reported and left alone (its password is NOT reset), and an account with that e-mail under another role is a
 * collision that is refused. The new account must still choose its own password at the first sign-in.
 */
export async function seedSuperAdmin(deps: AuthDeps, raw: { email: string; displayName: string; password: string }): Promise<{ created: boolean }> {
  const parsed = adminInput.safeParse({ email: raw.email, displayName: raw.displayName });
  if (!parsed.success) throw new AppError(400, "invalid_request", "The e-mail address or the name is not valid.");
  const problems = passwordProblems(raw.password, parsed.data.email);
  if (problems.length > 0) throw new WeakPassword(problems);
  const hash = await hashPassword(raw.password, deps.auth.argon2);
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const existing = (await tx.query<{ id: number | string; role: string }>("SELECT id, role FROM staff_users WHERE email = ?", [parsed.data.email])).rows[0];
    if (existing) {
      if (existing.role !== "super_admin") throw new AppError(409, "role_collision", "An account with this e-mail address exists under a different role. Nothing was changed.");
      return { created: false };
    }
    await tx.query("INSERT INTO staff_users (email, password_hash, role, display_name, active, must_change_password, created_at) VALUES (?, ?, 'super_admin', ?, 1, 1, ?)", [parsed.data.email, hash, parsed.data.displayName, now]);
    const id = Number((await tx.query<{ id: number | string }>("SELECT id FROM staff_users WHERE email = ?", [parsed.data.email])).rows[0]!.id);
    await writeAudit(tx, now, { actorType: "system", actorStaffId: null, action: "staff.created", entityType: "staff_user", entityId: id, details: { role: "super_admin" } });
    return { created: true };
  });
}
