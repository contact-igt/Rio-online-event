-- M5B question builder (append-only; nothing existing is changed or dropped).
-- The question builder needs three things the first schema had no column for:
--   active       a draft question can be switched off. Inactive questions are left out when the set is published (the published set is immutable).
--   min_choices  the fewest options a parent must tick on a checkbox question (NULL = no minimum).
--   max_choices  the most options a parent may tick on a checkbox question (NULL = no maximum).
-- Existing rows get active = 1 and no limits, so every published set keeps behaving exactly as before.
ALTER TABLE questions ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1, ADD COLUMN min_choices TINYINT UNSIGNED NULL, ADD COLUMN max_choices TINYINT UNSIGNED NULL
--> statement-breakpoint
ALTER TABLE questions ADD CONSTRAINT questions_active_ck CHECK (active IN (0, 1))
--> statement-breakpoint
ALTER TABLE questions ADD CONSTRAINT questions_choices_ck CHECK (
  (min_choices IS NULL AND max_choices IS NULL) OR (type = 'checkboxes' AND (min_choices IS NULL OR max_choices IS NULL OR min_choices <= max_choices))
)
