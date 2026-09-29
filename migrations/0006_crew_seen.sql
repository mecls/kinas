-- Done work clears (tasks/crew-done-clears/prd.md): when each page first showed a task finished — Kinas's own stamps,
-- as crew_decisions.copied_at is (0005). View state only: the mirror clears them when a task returns or is no longer
-- done or gone, and the Crew page's board and Home's Overnight leave a stamped task out from their next load. Nothing
-- is deleted.
--
-- Checked before writing this (task 0.2), on a .backup of the captain's store at version 5: both ALTERs apply.

ALTER TABLE crew_tasks ADD COLUMN board_seen_at INTEGER;
ALTER TABLE crew_tasks ADD COLUMN overnight_seen_at INTEGER;
