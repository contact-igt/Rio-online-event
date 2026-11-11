import { z } from "zod";
import { writeAudit } from "../auth/audit.ts";
import { generatePassword, hashPassword, type Argon2Cost } from "../auth/password.ts";
import type { DatabaseAdapter, Queryable } from "../db/adapter.ts";
import { asDate } from "../db/values.ts";
import { AppError } from "../http/errors.ts";

export type JudgeRow = {
  id: number;
  name: string;
  email: string;
  judgeCode: string;
  active: boolean;
  mustChangePassword: boolean;
  assigned: number;
  drafts: number;
  final: number;
  progress: number | null;
  lastLoginAt: string | null;
  createdAt: string;
};

export const provisionJudgeSchema = z.strictObject({
  email: z.string().trim().toLowerCase().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/u).max(254),
  displayName: z.string().trim().min(1).max(80),
});

export const setActiveSchema = z.strictObject({
  active: z.boolean(),
});

export const assignJudgeSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/u).max(60),
  judgeId: z.number().int().positive(),
});

const n = (v: unknown): number => Number(v ?? 0);

export async function listJudges(db: Queryable): Promise<{ judges: JudgeRow[] }> {
  const result = await db.query<{
    id: unknown;
    email: string;
    display_name: string;
    active: unknown;
    must_change_password: unknown;
    judge_code: string;
    last_login_at: unknown;
    created_at: unknown;
    assigned: unknown;
    drafts: unknown;
    final_count: unknown;
  }>(`
    SELECT
      u.id,
      u.email,
      u.display_name,
      u.active,
      u.must_change_password,
      p.judge_code,
      u.last_login_at,
      u.created_at,
      (SELECT COUNT(*) FROM judge_assignments a WHERE a.judge_id = u.id) AS assigned,
      (SELECT COUNT(*) FROM scores s WHERE s.judge_id = u.id AND s.status = 'draft') AS drafts,
      (SELECT COUNT(*) FROM scores s WHERE s.judge_id = u.id AND s.status = 'final') AS final_count
    FROM staff_users u
    JOIN judge_profiles p ON p.user_id = u.id
    WHERE u.role = 'judge'
    ORDER BY u.created_at DESC, u.id DESC
  `);

  const judges: JudgeRow[] = result.rows.map((r) => {
    const assigned = n(r.assigned);
    const final = n(r.final_count);
    return {
      id: n(r.id),
      name: r.display_name,
      email: r.email,
      judgeCode: r.judge_code,
      active: Number(r.active) === 1,
      mustChangePassword: Number(r.must_change_password) === 1,
      assigned,
      drafts: n(r.drafts),
      final,
      progress: assigned > 0 ? Math.round((final / assigned) * 100) : null,
      lastLoginAt: asDate(r.last_login_at)?.toISOString() ?? null,
      createdAt: asDate(r.created_at)?.toISOString() ?? new Date().toISOString(),
    };
  });

  return { judges };
}

function generateJudgeCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 5; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `JDG-${suffix}`;
}

export async function provisionJudge(
  db: DatabaseAdapter,
  now: Date,
  actor: { staffId: number; requestId: string },
  input: { email: string; displayName: string },
  cost: Argon2Cost,
): Promise<{ ok: true; id: number; email: string; displayName: string; judgeCode: string; generatedPassword: string }> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();

  const existing = await db.query<{ id: unknown }>("SELECT id FROM staff_users WHERE email = ?", [email]);
  if (existing.rows.length > 0) {
    throw new AppError(409, "duplicate_email", "An account with this email already exists.");
  }

  const generatedPassword = generatePassword();
  const passwordHash = await hashPassword(generatedPassword, cost);
  let judgeCode = generateJudgeCode();

  // Try inserting, with unique code fallback if collision
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const insertedId = await db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO staff_users (email, password_hash, role, display_name, active, must_change_password, created_at)
           VALUES (?, ?, 'judge', ?, 1, 1, ?)`,
          [email, passwordHash, displayName, now],
        );
        const userRow = (await tx.query<{ id: number | string }>("SELECT id FROM staff_users WHERE email = ?", [email])).rows[0]!;
        const userId = Number(userRow.id);

        await tx.query(
          `INSERT INTO judge_profiles (user_id, role, judge_code, created_at)
           VALUES (?, 'judge', ?, ?)`,
          [userId, judgeCode, now],
        );

        await writeAudit(tx, now, {
          actorType: "staff",
          actorStaffId: actor.staffId,
          action: "judge.provision",
          entityType: "staff_user",
          entityId: userId,
          requestId: actor.requestId,
          details: { judgeCode },
        });

        return userId;
      });

      return {
        ok: true,
        id: insertedId,
        email,
        displayName,
        judgeCode,
        generatedPassword,
      };
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "ER_DUP_ENTRY" && attempt < 2) {
        judgeCode = generateJudgeCode();
        continue;
      }
      throw err;
    }
  }

  throw new AppError(500, "provision_failed", "Failed to generate a unique judge code.");
}

export async function setJudgeActive(
  db: DatabaseAdapter,
  now: Date,
  actor: { staffId: number; requestId: string },
  input: { judgeId: number; active: boolean },
): Promise<{ ok: true }> {
  const target = await db.query<{ id: unknown; active: unknown }>(
    "SELECT id, active FROM staff_users WHERE id = ? AND role = 'judge'",
    [input.judgeId],
  );
  if (target.rows.length === 0) {
    throw new AppError(404, "not_found", "Judge not found.");
  }

  await db.transaction(async (tx) => {
    await tx.query("UPDATE staff_users SET active = ? WHERE id = ? AND role = 'judge'", [input.active ? 1 : 0, input.judgeId]);
    if (!input.active) {
      await tx.query("UPDATE staff_sessions SET revoked_at = ? WHERE staff_id = ? AND revoked_at IS NULL", [now, input.judgeId]);
    }
    await writeAudit(tx, now, {
      actorType: "staff",
      actorStaffId: actor.staffId,
      action: input.active ? "judge.activate" : "judge.deactivate",
      entityType: "staff_user",
      entityId: input.judgeId,
      requestId: actor.requestId,
    });
  });

  return { ok: true };
}

export async function resetJudgePassword(
  db: DatabaseAdapter,
  now: Date,
  actor: { staffId: number; requestId: string },
  input: { judgeId: number },
  cost: Argon2Cost,
): Promise<{ ok: true; generatedPassword: string }> {
  const target = await db.query<{ id: unknown }>(
    "SELECT id FROM staff_users WHERE id = ? AND role = 'judge'",
    [input.judgeId],
  );
  if (target.rows.length === 0) {
    throw new AppError(404, "not_found", "Judge not found.");
  }

  const generatedPassword = generatePassword();
  const passwordHash = await hashPassword(generatedPassword, cost);

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE staff_users
       SET password_hash = ?, must_change_password = 1, password_changed_at = ?
       WHERE id = ? AND role = 'judge'`,
      [passwordHash, now, input.judgeId],
    );
    await tx.query("UPDATE staff_sessions SET revoked_at = ? WHERE staff_id = ? AND revoked_at IS NULL", [now, input.judgeId]);
    await writeAudit(tx, now, {
      actorType: "staff",
      actorStaffId: actor.staffId,
      action: "judge.reset_password",
      entityType: "staff_user",
      entityId: input.judgeId,
      requestId: actor.requestId,
    });
  });

  return { ok: true, generatedPassword };
}

export async function assignJudgeToCompetition(
  db: DatabaseAdapter,
  now: Date,
  actor: { staffId: number; requestId: string },
  input: { slug: string; judgeId: number },
): Promise<{ ok: true; added: number }> {
  const judge = await db.query<{ id: unknown }>(
    "SELECT id FROM staff_users WHERE id = ? AND role = 'judge' AND active = 1",
    [input.judgeId],
  );
  if (judge.rows.length === 0) {
    throw new AppError(404, "judge_not_found", "Active judge not found.");
  }

  const eventRes = await db.query<{ id: unknown }>(
    "SELECT id FROM events WHERE slug = ?",
    [input.slug],
  );
  if (eventRes.rows.length === 0) {
    throw new AppError(404, "event_not_found", "Competition not found.");
  }
  const eventId = Number(eventRes.rows[0]?.id);

  const pendingSubmissions = await db.query<{ id: unknown }>(
    `SELECT s.id FROM submissions s
     WHERE s.event_id = ? AND s.status = 'finalized'
       AND NOT EXISTS (
         SELECT 1 FROM judge_assignments a
         WHERE a.judge_id = ? AND a.submission_id = s.id
       )`,
    [eventId, input.judgeId],
  );

  let added = 0;
  await db.transaction(async (tx) => {
    for (const sub of pendingSubmissions.rows) {
      const subId = Number(sub.id);
      await tx.query(
        `INSERT INTO judge_assignments (judge_id, submission_id, event_id, assigned_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [input.judgeId, subId, eventId, actor.staffId, now],
      );
      added++;
    }

    if (added > 0) {
      await writeAudit(tx, now, {
        actorType: "staff",
        actorStaffId: actor.staffId,
        action: "judge.assign_competition",
        entityType: "staff_user",
        entityId: input.judgeId,
        requestId: actor.requestId,
        details: { slug: input.slug, added },
      });
    }
  });

  return { ok: true, added };
}

