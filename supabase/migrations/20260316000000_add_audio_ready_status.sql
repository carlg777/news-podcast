ALTER TABLE podcasts DROP CONSTRAINT IF EXISTS podcasts_status_check;
ALTER TABLE podcasts ADD CONSTRAINT podcasts_status_check CHECK (status IN ('generating', 'audio_ready', 'ready', 'failed'));
