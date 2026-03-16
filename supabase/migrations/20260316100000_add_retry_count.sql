-- Add retry_count column for Phase 2 download retries
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS retry_count int NOT NULL DEFAULT 0;
