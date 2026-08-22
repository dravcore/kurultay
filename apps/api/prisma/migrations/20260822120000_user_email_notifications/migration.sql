-- Per-user opt-out for notification email (assignment, mention, due-soon).
--
-- NOT NULL with a default of true: every existing account keeps receiving what it would have
-- received before this column existed, and the one-row UPDATE Postgres needs for a constant
-- default is metadata-only on 11+, so the table is not rewritten.
ALTER TABLE "User" ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true;
