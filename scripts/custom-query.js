import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

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

export async function searchNewsAPI(queries, maxArticles = 5) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    console.warn('NEWS_API_KEY not set, skipping custom topic search');
    return [];
  }

  const now = new Date();
  const timeWindows = [
    new Date(now - 1 * 24 * 60 * 60 * 1000),
    new Date(now - 7 * 24 * 60 * 60 * 1000),
    new Date(now - 30 * 24 * 60 * 60 * 1000),
  ];

  for (const query of [queries.specific, queries.broad]) {
    for (const fromDate of timeWindows) {
      const params = new URLSearchParams({
        q: query,
        from: fromDate.toISOString().split('T')[0],
        sortBy: 'publishedAt',
        pageSize: String(maxArticles),
        apiKey,
      });

      try {
        const res = await fetch(`https://newsapi.org/v2/everything?${params}`);
        const data = await res.json();
        if (data.articles && data.articles.length > 0) {
          return data.articles.map(a => ({
            title: a.title,
            source: a.source?.name || 'News',
            url: a.url,
          }));
        }
      } catch (err) {
        console.warn(`News API search failed for "${query}":`, err.message);
      }
    }
  }

  return [];
}
