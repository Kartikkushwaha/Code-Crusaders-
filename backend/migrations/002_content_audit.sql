-- PUBLIVRA AI: optional, non-destructive addition to auth_content.
--
-- WHY: auth_content stores only the title and body. The reviewers' panels also show what the
-- creator sent with the submission: the three risk scores, open findings, fixes applied, the
-- image / video audit and the creator's note. This one nullable JSONB column holds that summary.
--
-- SAFE: adds one nullable column. No table is dropped, renamed or rewritten; existing rows keep
-- working (the column is NULL for them). It can be run more than once.
-- The backend works without it too: it then stores and returns the title and body only.
--
-- RUN ONCE, by hand, in the Neon SQL editor. The application never runs migrations itself.

ALTER TABLE auth_content ADD COLUMN IF NOT EXISTS audit JSONB;
