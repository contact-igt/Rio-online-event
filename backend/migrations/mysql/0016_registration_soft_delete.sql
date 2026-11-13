-- Keep deleted draft registrations for audit/history while hiding them from normal access.
ALTER TABLE submissions ADD COLUMN deleted_at DATETIME(3) NULL
--> statement-breakpoint
CREATE INDEX submissions_deleted_at_idx ON submissions (deleted_at)
