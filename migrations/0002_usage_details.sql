-- Usage page details chosen by Miguel on 2026-09-14, after the Build 1 hand-off.
--
-- hosts.disk_available_gb: what Finder calls "available" — free space plus the purgeable space macOS clears
--   for the user (NSURLVolumeAvailableCapacityForImportantUsageKey). GiB, like the other *_gb columns; NULL
--   when macOS does not report it.
-- quotas.models: the per-model request counts a provider reports for the window, as a JSON array of
--   {"name": string, "request_count": integer}; NULL when the provider reports none (Claude).

ALTER TABLE hosts ADD COLUMN disk_available_gb REAL;
ALTER TABLE quotas ADD COLUMN models TEXT;
