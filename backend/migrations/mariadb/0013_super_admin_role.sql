-- Adds the role super_admin to staff_users (roles: super_admin, admin, judge) and widens the column to VARCHAR(16), because 'super_admin' has
-- 11 characters. judge_profiles points at UNIQUE (id, role), and MySQL does not let a column inside a foreign key be resized, so that one
-- foreign key is dropped and put back unchanged around the change. Existing rows are untouched; the key and every other constraint stay.
ALTER TABLE judge_profiles DROP FOREIGN KEY judge_profiles_staff_fk
--> statement-breakpoint
ALTER TABLE staff_users DROP CONSTRAINT staff_users_role_ck
--> statement-breakpoint
ALTER TABLE staff_users MODIFY role VARCHAR(16) COLLATE utf8mb4_nopad_bin NOT NULL
--> statement-breakpoint
ALTER TABLE staff_users ADD CONSTRAINT staff_users_role_ck CHECK (role IN ('super_admin', 'admin', 'judge'))
--> statement-breakpoint
ALTER TABLE judge_profiles ADD CONSTRAINT judge_profiles_staff_fk FOREIGN KEY (user_id, role) REFERENCES staff_users (id, role)
