import Parser from 'rss-parser';

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'NewsPodcastBot/1.0' },
});

export const RSS_FEEDS = {
  ai: {
    name: 'AI',
    defaultArticles: 8,
    feeds: [
      'https://openai.com/blog/rss.xml',
      'https://www.anthropic.com/rss.xml',
      'https://blog.google/technology/ai/rss/',
      'https://deepmind.google/blog/rss.xml',
      'https://techcrunch.com/category/artificial-intelligence/feed/',
      'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
      'https://www.technologyreview.com/feed/',
    ],
  },
  tech: {
    name: 'Tech',
    defaultArticles: 5,
    feeds: [
      'https://techcrunch.com/feed/',
      'https://www.theverge.com/rss/index.xml',
      'https://feeds.arstechnica.com/arstechnica/index',
      'https://www.wired.com/feed/rss',
    ],
  },
  gadgets: {
    name: 'Gadgets',
    defaultArticles: 5,
    feeds: [
      'https://www.theverge.com/rss/reviews/index.xml',
      'https://www.engadget.com/rss.xml',
      'https://www.cnet.com/rss/news/',
    ],
  },
  world: {
    name: 'World',
    defaultArticles: 5,
    feeds: [
      'https://feeds.reuters.com/reuters/topNews',
      'https://rss.app/feeds/v1.1/apnews-world.xml',
      'https://feeds.bbci.co.uk/news/world/rss.xml',
    ],
  },
  'us-news': {
    name: 'US News',
    defaultArticles: 5,
    feeds: [
      'https://rss.app/feeds/v1.1/apnews-us.xml',
      'https://feeds.npr.org/1001/rss.xml',
      'https://www.pbs.org/newshour/feeds/rss/headlines',
    ],
  },
  local: {
    name: 'Local News',
    defaultArticles: 5,
    feeds: [],
  },
};

export async function fetchArticlesForTopic(topicId, maxArticles) {
  const topicConfig = RSS_FEEDS[topicId];
  if (!topicConfig || topicConfig.feeds.length === 0) {
    console.warn(`No feeds configured for topic: ${topicId}`);
    return [];
  }

  const limit = maxArticles || topicConfig.defaultArticles;
  const now = new Date();
  const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const feedResults = await Promise.allSettled(
    topicConfig.feeds.map(async (feedUrl) => {
      try {
        const feed = await parser.parseURL(feedUrl);
        return (feed.items || []).map(item => ({
          title: item.title || 'Untitled',
          source: feed.title || new URL(feedUrl).hostname,
          url: item.link || item.guid,
          pubDate: item.pubDate ? new Date(item.pubDate) : now,
        }));
      } catch (err) {
        console.warn(`Failed to fetch feed ${feedUrl}:`, err.message);
        return [];
      }
    })
  );

  let articles = feedResults
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(a => a.url);

  let filtered = articles.filter(a => a.pubDate >= threeDaysAgo);
  if (filtered.length === 0) filtered = articles.filter(a => a.pubDate >= oneWeekAgo);
  if (filtered.length === 0) filtered = articles.filter(a => a.pubDate >= oneMonthAgo);
  if (filtered.length === 0) filtered = articles;

  const seen = new Set();
  return filtered
    .sort((a, b) => b.pubDate - a.pubDate)
    .filter(a => { if (seen.has(a.url)) return false; seen.add(a.url); return true; })
    .slice(0, limit)
    .map(({ title, source, url }) => ({ title, source, url }));
}
