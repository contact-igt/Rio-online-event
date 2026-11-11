-- rio:foreign-keys-off
-- Adds the role super_admin to staff_users (roles: super_admin, admin, judge). SQLite cannot change a CHECK constraint, so the table is rebuilt
-- with the procedure from the SQLite documentation (see 0011). Every column, constraint and the UNIQUE (id, role) key that judge_profiles
-- points at are copied unchanged except the role CHECK. Existing rows are copied with their ids, so every foreign key keeps working; the
-- runner checks PRAGMA foreign_key_check before COMMIT.
PRAGMA legacy_alter_table = ON
--> statement-breakpoint
CREATE TABLE staff_users_rebuild (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  password_changed_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT staff_users_email_uq UNIQUE (email),
  CONSTRAINT staff_users_id_role_uq UNIQUE (id, role),
  CONSTRAINT staff_users_role_ck CHECK (role IN ('super_admin', 'admin', 'judge')),
  CONSTRAINT staff_users_email_ck CHECK (
    length(email) <= 254 AND email = lower(email) AND email LIKE '_%@_%._%' AND email NOT LIKE '% %' AND length(email) - length(replace(email, '@', '')) = 1
  ),
  CONSTRAINT staff_users_hash_ck CHECK (length(password_hash) BETWEEN 20 AND 255),
  CONSTRAINT staff_users_name_ck CHECK (length(trim(display_name)) >= 1 AND length(display_name) <= 80),
  CONSTRAINT staff_users_flags_ck CHECK (active IN (0, 1) AND must_change_password IN (0, 1) AND failed_logins BETWEEN 0 AND 65535)
) STRICT
--> statement-breakpoint
INSERT INTO staff_users_rebuild (id, email, password_hash, role, display_name, active, must_change_password, failed_logins, locked_until, password_changed_at, last_login_at, created_at)
SELECT id, email, password_hash, role, display_name, active, must_change_password, failed_logins, locked_until, password_changed_at, last_login_at, created_at FROM staff_users
--> statement-breakpoint
DROP TABLE staff_users
--> statement-breakpoint
ALTER TABLE staff_users_rebuild RENAME TO staff_users
--> statement-breakpoint
PRAGMA legacy_alter_table = OFF
