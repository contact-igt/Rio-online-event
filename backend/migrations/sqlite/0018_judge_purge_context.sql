-- A transaction-scoped capability used only by the Super Admin judge purge workflow.
CREATE TABLE IF NOT EXISTS judge_purge_context (
  judge_id INTEGER NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')),
  CONSTRAINT judge_purge_context_fk FOREIGN KEY (judge_id) REFERENCES staff_users (id)
) STRICT
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_delete
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'rule: audit_log is append-only')
  WHERE NOT EXISTS (SELECT 1 FROM judge_purge_context WHERE judge_id = OLD.actor_staff_id);
END
--> statement-breakpoint
DROP TRIGGER IF EXISTS scores_guard_delete
--> statement-breakpoint
CREATE TRIGGER scores_guard_delete BEFORE DELETE ON scores FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'rule: a final score cannot be deleted')
  WHERE OLD.status = 'final' AND NOT EXISTS (SELECT 1 FROM judge_purge_context WHERE judge_id = OLD.judge_id);
END
--> statement-breakpoint
DROP TRIGGER IF EXISTS duplicate_reviews_guard_delete
--> statement-breakpoint
CREATE TRIGGER duplicate_reviews_guard_delete BEFORE DELETE ON duplicate_reviews FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'rule: reviews are kept as part of the audit trail')
  WHERE NOT EXISTS (SELECT 1 FROM judge_purge_context WHERE judge_id = OLD.decided_by);
END
