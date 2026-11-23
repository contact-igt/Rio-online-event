-- A transaction-scoped capability used only by the Super Admin judge purge workflow.
-- The application inserts the deleted judge id, removes the selected linked history, and removes this row before deleting the account.
CREATE TABLE IF NOT EXISTS judge_purge_context (
  judge_id BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (judge_id),
  CONSTRAINT judge_purge_context_fk FOREIGN KEY (judge_id) REFERENCES staff_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_delete
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM judge_purge_context WHERE judge_id = OLD.actor_staff_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rule: audit_log is append-only';
  END IF;
END
--> statement-breakpoint
DROP TRIGGER IF EXISTS scores_guard_delete
--> statement-breakpoint
CREATE TRIGGER scores_guard_delete BEFORE DELETE ON scores FOR EACH ROW
BEGIN
  IF OLD.status = 'final' AND NOT EXISTS (SELECT 1 FROM judge_purge_context WHERE judge_id = OLD.judge_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rule: a final score cannot be deleted';
  END IF;
END
--> statement-breakpoint
DROP TRIGGER IF EXISTS duplicate_reviews_guard_delete
--> statement-breakpoint
CREATE TRIGGER duplicate_reviews_guard_delete BEFORE DELETE ON duplicate_reviews FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM judge_purge_context WHERE judge_id = OLD.decided_by) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rule: reviews are kept as part of the audit trail';
  END IF;
END
