import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { fetchArticlesForTopic } from './rss-feeds.js';
import { cleanCustomQuery, searchGoogleNews } from './custom-query.js';
import { refreshAuth, createNotebook, addSource, generateAudio, downloadAudio, deleteNotebook, getSourceIds } from './notebooklm.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DEFAULT_TOPICS = ['ai'];
const DEFAULT_ARTICLE_COUNT = 8;

async function updatePodcast(podcastId, updates) {
  const { error } = await supabase.from('podcasts').update(updates).eq('id', podcastId);
  if (error) console.error('Failed to update podcast:', error);
}

async function main() {
  const podcastId = process.env.INPUT_PODCAST_ID || null;
  const topics = process.env.INPUT_TOPICS ? JSON.parse(process.env.INPUT_TOPICS) : DEFAULT_TOPICS;
  const customQuery = process.env.INPUT_CUSTOM_QUERY || null;
  const articleCount = parseInt(process.env.INPUT_ARTICLE_COUNT || String(DEFAULT_ARTICLE_COUNT), 10);

  let id = podcastId;

  try {
    if (!id) {
      const { data, error } = await supabase
        .from('podcasts')
        .insert({ topics, status: 'generating', article_count: articleCount })
        .select('id')
        .single();
      if (error) throw error;
      id = data.id;
    }

    console.log(`Pipeline started for podcast ${id}, topics: ${topics.join(', ')}`);

    await refreshAuth();

    let allArticles = [];
    for (const topic of topics) {
      if (topic === 'custom' && customQuery) {
        console.log(`Cleaning custom query: "${customQuery}"`);
        const cleaned = await cleanCustomQuery(customQuery);
        console.log(`Cleaned queries: ${JSON.stringify(cleaned)}`);
        const customArticles = await searchGoogleNews(cleaned, articleCount);
        allArticles.push(...customArticles);
      } else if (topic !== 'custom') {
        const topicArticles = await fetchArticlesForTopic(topic, articleCount);
        allArticles.push(...topicArticles);
      }
    }

    const seen = new Set();
    allArticles = allArticles.filter(a => { if (seen.has(a.url)) return false; seen.add(a.url); return true; });

    if (allArticles.length === 0) throw new Error('No articles found for the selected topics');

    console.log(`Collected ${allArticles.length} unique articles`);

    await updatePodcast(id, { articles: allArticles, article_count: allArticles.length });

    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const notebookTitle = `News Podcast — ${today}`;
    const notebookId = await createNotebook(notebookTitle);
    await updatePodcast(id, { notebook_id: notebookId });

    const sourceIds = [];
    for (const article of allArticles) {
      try {
        const sourceId = await addSource(notebookId, article.url);
        if (sourceId) sourceIds.push(sourceId);
        // Delay between sources to avoid rate limiting
        await new Promise(r => setTimeout(r, 3000));
      } catch (err) { console.warn(`Failed to add source ${article.url}:`, err.message); }
    }

    console.log(`Collected ${sourceIds.length} source IDs of ${allArticles.length} articles`);

    if (sourceIds.length === 0) {
      throw new Error('No source IDs collected — cannot generate audio');
    }

    // Wait for NotebookLM to finish indexing
    console.log('Waiting 15s for sources to index...');
    await new Promise(r => setTimeout(r, 15000));

    const { audioUrl } = await generateAudio(notebookId, sourceIds);

    // Phase 1 complete: audio is generated on NotebookLM.
    // Store the NLM audio URL and set status to "audio_ready".
    // Phase 2 (local cron) will download and upload to Supabase Storage.
    await updatePodcast(id, { audio_url: audioUrl, status: 'audio_ready' });

    console.log(`Podcast ${id} audio ready for download: ${audioUrl.slice(0, 80)}...`);

    try { await cleanupOldPodcasts(); } catch (cleanupErr) {
      console.warn('Cleanup failed (non-fatal):', cleanupErr.message);
    }
    console.log('Pipeline complete.');
  } catch (err) {
    console.error('Pipeline failed:', err);
    if (id) await updatePodcast(id, { status: 'failed', error_message: err.message });
    process.exit(1);
  }
}

async function cleanupOldPodcasts() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: oldPodcasts, error } = await supabase
    .from('podcasts')
    .select('id, notebook_id, audio_url')
    .lt('created_at', sevenDaysAgo.toISOString());

  if (error || !oldPodcasts || oldPodcasts.length === 0) return;

  console.log(`Cleaning up ${oldPodcasts.length} old podcasts...`);

  for (const podcast of oldPodcasts) {
    try { await supabase.storage.from('podcast-audio').remove([`${podcast.id}.m4a`]); }
    catch (err) { console.warn(`Failed to delete audio for ${podcast.id}:`, err.message); }
    if (podcast.notebook_id) await deleteNotebook(podcast.notebook_id);
    await supabase.from('podcasts').delete().eq('id', podcast.id);
  }
}

main();
