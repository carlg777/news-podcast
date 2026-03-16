import Anthropic from '@anthropic-ai/sdk';
import Parser from 'rss-parser';

const anthropic = new Anthropic();
const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'NewsPodcastBot/1.0' },
});

export async function cleanCustomQuery(rawQuery) {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: `You are a search query optimizer. The user typed a messy search query for finding recent news articles. Fix typos, extract intent, and return two clean search queries.

User input: "${rawQuery}"

Respond with ONLY valid JSON (no markdown):
{"specific": "exact focused query", "broad": "broader fallback query"}`,
      },
    ],
  });

  const text = response.content[0].text.trim();
  try {
    return JSON.parse(text);
  } catch {
    return { specific: rawQuery, broad: rawQuery };
  }
}

/**
 * Search Google News RSS with cleaned queries.
 * Free, no API key, no rate limits.
 * Returns array of { title, source, url }
 */
export async function searchGoogleNews(queries, maxArticles = 5) {
  for (const query of [queries.specific, queries.broad]) {
    const encoded = encodeURIComponent(query);
    const feedUrl = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;

    try {
      const feed = await parser.parseURL(feedUrl);
      const articles = (feed.items || []).slice(0, maxArticles).map(item => ({
        title: (item.title || 'Untitled').replace(/ - .*$/, ''),
        source: item.title?.match(/ - (.+)$/)?.[1] || 'Google News',
        url: item.link || item.guid,
      }));

      if (articles.length > 0) {
        console.log(`Google News found ${articles.length} articles for "${query}"`);
        return articles;
      }
    } catch (err) {
      console.warn(`Google News search failed for "${query}":`, err.message);
    }
  }

  return [];
}
