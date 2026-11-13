-- Permanent delete (append-only; nothing existing is edited). Two delete guards are relaxed for ONE case only: the owning submission is a soft-deleted
-- DRAFT. Duplicate-review rows and upload rows of any other entry stay undeletable, exactly as before. The application adds its own blockers
-- (assignments, winners, reviews of other entries) and removes the stored video object before it deletes anything here.
DROP TRIGGER IF EXISTS duplicate_reviews_guard_delete
--> statement-breakpoint
CREATE TRIGGER duplicate_reviews_guard_delete BEFORE DELETE ON duplicate_reviews FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM submissions WHERE id = OLD.submission_id AND deleted_at IS NOT NULL AND status = 'draft') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rule: reviews are kept as part of the audit trail';
  END IF;
END
--> statement-breakpoint
DROP TRIGGER IF EXISTS video_uploads_no_delete
--> statement-breakpoint
CREATE TRIGGER video_uploads_no_delete BEFORE DELETE ON video_uploads FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM submissions WHERE id = OLD.submission_id AND deleted_at IS NOT NULL AND status = 'draft') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rule: upload rows are kept; mark them deleted instead';
  END IF;
END
