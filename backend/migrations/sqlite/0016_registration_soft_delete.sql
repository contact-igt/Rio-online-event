-- Keep deleted draft registrations for audit/history while hiding them from normal access.
ALTER TABLE submissions ADD COLUMN deleted_at TEXT
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS submissions_deleted_at_idx ON submissions (deleted_at)
