import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabase
      .from('podcasts')
      .select('id, topics, article_count, articles, audio_url, duration_seconds, status, created_at')
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({ podcasts: data });
  } catch (err) {
    console.error('Error fetching podcasts:', err);
    return res.status(500).json({ error: 'Failed to fetch podcasts' });
  }
}
