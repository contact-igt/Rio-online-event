-- Results may not be scheduled before 14 November 2026 00:00 Asia/Kolkata (2026-11-13 18:30 UTC).
DROP TRIGGER IF EXISTS event_settings_results_floor_guard
--> statement-breakpoint
CREATE TRIGGER event_settings_results_floor_guard BEFORE UPDATE ON event_settings FOR EACH ROW
BEGIN
  IF NEW.results_publish_at IS NOT NULL AND NEW.results_publish_at < '2026-11-13 18:30:00.000' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rule: results cannot be published before 14 November 2026 Asia/Kolkata';
  END IF;
END
