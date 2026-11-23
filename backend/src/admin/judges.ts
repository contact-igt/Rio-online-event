import { z } from "zod";
import { writeAudit } from "../auth/audit.ts";
import { generatePassword, hashPassword, type Argon2Cost } from "../auth/password.ts";
import type { DatabaseAdapter, Queryable } from "../db/adapter.ts";
import { DatabaseError } from "../db/errors.ts";
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

export const updateJudgeSchema = provisionJudgeSchema;

export const assignJudgeSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/u).max(60),
  judgeId: z.number().int().positive(),
});

const n = (v: unknown): number => Number(v ?? 0);

export type DeletedJudgeRow = { id: number; name: string; email: string; judgeCode: string; deletedAt: string };

export type JudgePurgeImpact = {
  judge: DeletedJudgeRow;
  counts: {
    assignments: number;
    assignmentsCreated: number;
    scores: number;
    finalScores: number;
    draftScores: number;
    scoresUnlocked: number;
    auditActivity: number;
    sessions: number;
    duplicateReviews: number;
    winners: number;
    questionSets: number;
    settingsChanges: number;
  };
  canPurge: boolean;
  blockers: ("assignmentsCreated" | "scoresUnlocked" | "winners" | "questionSets" | "settingsChanges")[];
};

export async function listDeletedJudges(db: Queryable): Promise<{ judges: DeletedJudgeRow[] }> {
  const result = await db.query<{ id: unknown; display_name: string; email: string; judge_code: string; deleted_at: unknown }>(
    `SELECT u.id, u.display_name, u.email, p.judge_code, u.deleted_at
     FROM staff_users u JOIN judge_profiles p ON p.user_id = u.id
     WHERE u.role = 'judge' AND u.deleted_at IS NOT NULL
     ORDER BY u.deleted_at DESC, u.id DESC`,
  );
  return { judges: result.rows.map((r) => ({ id: n(r.id), name: r.display_name, email: r.email, judgeCode: r.judge_code, deletedAt: asDate(r.deleted_at).toISOString() })) };
}

/** Shows the linked rows before a permanent purge. Counts are deliberately grouped by what will be removed or what must stay. */
export async function loadJudgePurgeImpact(db: Queryable, judgeId: number): Promise<JudgePurgeImpact> {
  const judge = (await db.query<{ id: unknown; display_name: string; email: string; judge_code: string; deleted_at: unknown }>(
    `SELECT u.id, u.display_name, u.email, p.judge_code, u.deleted_at
     FROM staff_users u JOIN judge_profiles p ON p.user_id = u.id
     WHERE u.id = ? AND u.role = 'judge' AND u.deleted_at IS NOT NULL`,
    [judgeId],
  )).rows[0];
  if (!judge) throw new AppError(404, "not_found", "Judge not found.");

  const counts = (await db.query<{
    assignments: unknown; assignments_created: unknown; scores: unknown; final_scores: unknown; draft_scores: unknown; scores_unlocked: unknown;
    audit_activity: unknown; sessions: unknown; duplicate_reviews: unknown; winners: unknown; question_sets: unknown; settings_changes: unknown;
  }>(
    `SELECT
      (SELECT COUNT(*) FROM judge_assignments WHERE judge_id = ?) AS assignments,
      (SELECT COUNT(*) FROM judge_assignments WHERE assigned_by = ?) AS assignments_created,
      (SELECT COUNT(*) FROM scores WHERE judge_id = ?) AS scores,
      (SELECT COUNT(*) FROM scores WHERE judge_id = ? AND status = 'final') AS final_scores,
      (SELECT COUNT(*) FROM scores WHERE judge_id = ? AND status = 'draft') AS draft_scores,
      (SELECT COUNT(*) FROM scores WHERE unlocked_by = ? AND judge_id <> ?) AS scores_unlocked,
      (SELECT COUNT(*) FROM audit_log WHERE actor_staff_id = ?) AS audit_activity,
      (SELECT COUNT(*) FROM staff_sessions WHERE staff_id = ?) AS sessions,
      (SELECT COUNT(*) FROM duplicate_reviews WHERE decided_by = ?) AS duplicate_reviews,
      (SELECT COUNT(*) FROM winners WHERE approved_by = ?) AS winners,
      (SELECT COUNT(*) FROM question_sets WHERE created_by = ? OR published_by = ?) AS question_sets,
      (SELECT COUNT(*) FROM event_settings WHERE updated_by = ?) AS settings_changes`,
    [judgeId, judgeId, judgeId, judgeId, judgeId, judgeId, judgeId, judgeId, judgeId, judgeId, judgeId, judgeId, judgeId, judgeId],
  )).rows[0]!;
  const result = {
    assignments: n(counts.assignments),
    assignmentsCreated: n(counts.assignments_created),
    scores: n(counts.scores),
    finalScores: n(counts.final_scores),
    draftScores: n(counts.draft_scores),
    scoresUnlocked: n(counts.scores_unlocked),
    auditActivity: n(counts.audit_activity),
    sessions: n(counts.sessions),
    duplicateReviews: n(counts.duplicate_reviews),
    winners: n(counts.winners),
    questionSets: n(counts.question_sets),
    settingsChanges: n(counts.settings_changes),
  };
  const blockers = (Object.entries({
    assignmentsCreated: result.assignmentsCreated,
    scoresUnlocked: result.scoresUnlocked,
    winners: result.winners,
    questionSets: result.questionSets,
    settingsChanges: result.settingsChanges,
  }) as [JudgePurgeImpact["blockers"][number], number][]).filter(([, value]) => value > 0).map(([key]) => key);
  return {
    judge: { id: n(judge.id), name: judge.display_name, email: judge.email, judgeCode: judge.judge_code, deletedAt: asDate(judge.deleted_at).toISOString() },
    counts: result,
    canPurge: blockers.length === 0,
    blockers,
  };
}

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
    WHERE u.role = 'judge' AND u.deleted_at IS NULL
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
      lastLoginAt: r.last_login_at == null ? null : asDate(r.last_login_at).toISOString(),
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
      // The database layer reports any unique-key clash as DatabaseError(constraint "unique"); the e-mail was checked above, so it is the code.
      if (err instanceof DatabaseError && err.constraint === "unique" && attempt < 2) {
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
    "SELECT id, active FROM staff_users WHERE id = ? AND role = 'judge' AND deleted_at IS NULL",
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

export async function updateJudge(
  db: DatabaseAdapter,
  now: Date,
  actor: { staffId: number; requestId: string },
  input: { judgeId: number; email: string; displayName: string },
): Promise<{ ok: true; name: string; email: string }> {
  const target = await db.query<{ id: unknown }>(
    "SELECT id FROM staff_users WHERE id = ? AND role = 'judge' AND deleted_at IS NULL",
    [input.judgeId],
  );
  if (target.rows.length === 0) throw new AppError(404, "not_found", "Judge not found.");

  const email = input.email.trim().toLowerCase();
  const name = input.displayName.trim();
  const clash = await db.query<{ id: unknown }>("SELECT id FROM staff_users WHERE email = ? AND id <> ?", [email, input.judgeId]);
  if (clash.rows.length > 0) throw new AppError(409, "duplicate_email", "An account with this email already exists.");

  await db.transaction(async (tx) => {
    await tx.query("UPDATE staff_users SET email = ?, display_name = ? WHERE id = ? AND role = 'judge'", [email, name, input.judgeId]);
    await writeAudit(tx, now, {
      actorType: "staff",
      actorStaffId: actor.staffId,
      action: "judge.update",
      entityType: "staff_user",
      entityId: input.judgeId,
      requestId: actor.requestId,
    });
  });

  return { ok: true, name, email };
}

/** Soft delete: the row, its assignments and its scores stay for the record; the account just stops working and leaves the roster. */
export async function deleteJudge(
  db: DatabaseAdapter,
  now: Date,
  actor: { staffId: number; requestId: string },
  input: { judgeId: number },
): Promise<{ ok: true }> {
  const target = await db.query<{ deleted_at: unknown }>(
    "SELECT deleted_at FROM staff_users WHERE id = ? AND role = 'judge'",
    [input.judgeId],
  );
  if (target.rows.length === 0) throw new AppError(404, "not_found", "Judge not found.");
  if (target.rows[0]!.deleted_at != null) return { ok: true }; // already deleted: repeating is harmless

  await db.transaction(async (tx) => {
    await tx.query("UPDATE staff_users SET active = 0, deleted_at = ? WHERE id = ? AND role = 'judge' AND deleted_at IS NULL", [now, input.judgeId]);
    await tx.query("UPDATE staff_sessions SET revoked_at = ? WHERE staff_id = ? AND revoked_at IS NULL", [now, input.judgeId]);
    await writeAudit(tx, now, {
      actorType: "staff",
      actorStaffId: actor.staffId,
      action: "judge.delete",
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
    "SELECT id FROM staff_users WHERE id = ? AND role = 'judge' AND deleted_at IS NULL",
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

export async function unassignJudgeFromCompetition(
  db: DatabaseAdapter,
  now: Date,
  actor: { staffId: number; requestId: string },
  input: { slug: string; judgeId: number },
): Promise<{ ok: true; removed: number }> {
  const event = await db.query<{ id: unknown }>("SELECT id FROM events WHERE slug = ?", [input.slug]);
  if (event.rows.length === 0) throw new AppError(404, "event_not_found", "Competition not found.");
  const eventId = Number(event.rows[0]?.id);

  const scored = await db.query<{ n: unknown }>(
    `SELECT COUNT(*) AS n
     FROM scores sc
     JOIN judge_assignments a ON a.judge_id = sc.judge_id AND a.submission_id = sc.submission_id
     WHERE a.event_id = ? AND a.judge_id = ?`,
    [eventId, input.judgeId],
  );
  if (Number(scored.rows[0]?.n ?? 0) > 0) {
    throw new AppError(409, "judge_has_scores", "This judge cannot be removed because they already have scores in this competition.");
  }

  let removed = 0;
  await db.transaction(async (tx) => {
    const result = await tx.query(
      "DELETE FROM judge_assignments WHERE event_id = ? AND judge_id = ?",
      [eventId, input.judgeId],
    );
    removed = result.affectedRows;
    if (removed > 0) {
      await writeAudit(tx, now, {
        actorType: "staff",
        actorStaffId: actor.staffId,
        action: "judge.unassign_competition",
        entityType: "staff_user",
        entityId: input.judgeId,
        requestId: actor.requestId,
        details: { slug: input.slug, removed },
      });
    }
  });

  return { ok: true, removed };
}

/** Brings a soft-deleted judge back to the roster. The account stays switched OFF: the Super Admin reactivates it on purpose. */
export async function restoreJudge(db: DatabaseAdapter, now: Date, actor: { staffId: number; requestId: string }, input: { judgeId: number }): Promise<{ ok: true }> {
  await db.transaction(async (tx) => {
    const done = await tx.query("UPDATE staff_users SET deleted_at = NULL WHERE id = ? AND role = 'judge' AND deleted_at IS NOT NULL", [input.judgeId]);
    if (done.affectedRows !== 1) throw new AppError(404, "not_found", "Judge not found.");
    await writeAudit(tx, now, { actorType: "staff", actorStaffId: actor.staffId, action: "judge.restored", entityType: "staff_user", entityId: input.judgeId, requestId: actor.requestId });
  });
  return { ok: true };
}

/** Permanent purge after the impact review. Safe-to-remove judge-owned history is removed in one transaction; structural/public links stay blocked. */
export async function purgeJudge(db: DatabaseAdapter, now: Date, actor: { staffId: number; requestId: string }, input: { judgeId: number }): Promise<{ ok: true }> {
  const id = input.judgeId;
  const impact = await loadJudgePurgeImpact(db, id);
  if (!impact.canPurge) throw new AppError(409, "judge_purge_blocked", "This judge is linked to records that must be reviewed before permanent deletion.");

  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO judge_purge_context (judge_id) VALUES (?)", [id]);
    await tx.query("DELETE FROM duplicate_reviews WHERE decided_by = ?", [id]);
    await tx.query("DELETE FROM scores WHERE judge_id = ?", [id]);
    await tx.query("DELETE FROM judge_assignments WHERE judge_id = ?", [id]);
    await tx.query("DELETE FROM audit_log WHERE actor_staff_id = ?", [id]);
    await tx.query("DELETE FROM judge_purge_context WHERE judge_id = ?", [id]);
    await tx.query("DELETE FROM staff_sessions WHERE staff_id = ?", [id]);
    await tx.query("DELETE FROM judge_profiles WHERE user_id = ?", [id]);
    const gone = await tx.query("DELETE FROM staff_users WHERE id = ? AND role = 'judge' AND deleted_at IS NOT NULL", [id]);
    if (gone.affectedRows !== 1) throw new AppError(404, "not_found", "Judge not found.");
    await writeAudit(tx, now, { actorType: "staff", actorStaffId: actor.staffId, action: "judge.purged", entityType: "staff_user", entityId: id, requestId: actor.requestId });
  });
  return { ok: true };
}
