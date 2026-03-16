import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing podcast ID' });
  }

  try {
    const { data, error } = await supabase
      .from('podcasts')
      .select('id, status, audio_url, duration_seconds, error_message, topics, articles, article_count, created_at')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Podcast not found' });

    return res.status(200).json(data);
  } catch (err) {
    console.error('Error fetching podcast status:', err);
    return res.status(500).json({ error: 'Failed to fetch status' });
  }
}
