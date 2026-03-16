-- Create podcasts table
CREATE TABLE IF NOT EXISTS podcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topics text[] NOT NULL DEFAULT '{}',
  custom_query text,
  article_count int DEFAULT 0,
  articles jsonb DEFAULT '[]'::jsonb,
  audio_url text,
  notebook_id text,
  duration_seconds int,
  status text NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'ready', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: Enable row-level security
ALTER TABLE podcasts ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read podcasts (anon key)
CREATE POLICY "Public read access" ON podcasts
  FOR SELECT USING (true);

-- Policy: Service role can insert/update/delete
CREATE POLICY "Service role full access" ON podcasts
  FOR ALL USING (auth.role() = 'service_role');

-- Create index for date-based queries
CREATE INDEX idx_podcasts_created_at ON podcasts (created_at DESC);

-- Note: Create storage bucket 'podcast-audio' (public) via Supabase dashboard
-- Settings > Storage > New bucket > name: podcast-audio, Public: ON
