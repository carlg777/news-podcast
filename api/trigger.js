import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.TRIGGER_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { topics, customQuery, articleCount } = req.body;

  if (!topics || !Array.isArray(topics) || topics.length === 0) {
    return res.status(400).json({ error: 'At least one topic is required' });
  }

  try {
    // Rate limit: check for active generation
    const { data: active } = await supabase
      .from('podcasts')
      .select('id')
      .eq('status', 'generating')
      .limit(1);

    if (active && active.length > 0) {
      return res.status(429).json({ error: 'A podcast is already being generated. Please wait.' });
    }

    // Rate limit: check for recent generation (last 10 minutes)
    const tenMinutesAgo = new Date();
    tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);

    const { data: recent } = await supabase
      .from('podcasts')
      .select('id')
      .gte('created_at', tenMinutesAgo.toISOString())
      .limit(1);

    if (recent && recent.length > 0) {
      return res.status(429).json({ error: 'Please wait at least 10 minutes between generations.' });
    }

    // Create podcast row
    const { data: podcast, error: insertError } = await supabase
      .from('podcasts')
      .insert({
        topics,
        custom_query: customQuery || null,
        article_count: articleCount || 5,
        status: 'generating',
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    // Fire GitHub Actions workflow
    const [owner, repo] = (process.env.GITHUB_REPO || '').split('/');
    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/generate-podcast.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            podcastId: podcast.id,
            topics: JSON.stringify(topics),
            customQuery: customQuery || '',
            articleCount: String(articleCount || 5),
          },
        }),
      }
    );

    if (!ghRes.ok) {
      const ghError = await ghRes.text();
      console.error('GitHub Actions dispatch failed:', ghError);
      await supabase.from('podcasts').update({
        status: 'failed',
        error_message: 'Failed to start generation pipeline',
      }).eq('id', podcast.id);
      return res.status(500).json({ error: 'Failed to start generation' });
    }

    return res.status(200).json({ id: podcast.id });
  } catch (err) {
    console.error('Trigger error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
