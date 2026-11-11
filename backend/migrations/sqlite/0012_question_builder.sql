-- M5B question builder (append-only; nothing existing is changed or dropped). See the MySQL file of the same name for the reasons.
-- Existing rows get active = 1 and no limits. max_choices is added first because the check on min_choices refers to it.
ALTER TABLE questions ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CONSTRAINT questions_active_ck CHECK (active IN (0, 1))
--> statement-breakpoint
ALTER TABLE questions ADD COLUMN max_choices INTEGER CONSTRAINT questions_max_choices_ck CHECK (max_choices IS NULL OR (type = 'checkboxes' AND max_choices BETWEEN 1 AND 255))
--> statement-breakpoint
ALTER TABLE questions ADD COLUMN min_choices INTEGER CONSTRAINT questions_min_choices_ck CHECK (min_choices IS NULL OR (type = 'checkboxes' AND min_choices BETWEEN 0 AND 255 AND (max_choices IS NULL OR min_choices <= max_choices)))
