-- Soft delete for judge accounts (append-only). A deleted judge keeps its row, so assignments, scores and audit history stay intact;
-- the application treats deleted_at IS NOT NULL as "gone" (no login, hidden from the roster). Existing rows stay NULL = not deleted.
ALTER TABLE staff_users ADD COLUMN deleted_at DATETIME(3) NULL
