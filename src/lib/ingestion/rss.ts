import Parser from 'rss-parser';
import type { RawArticle } from '@/types';
import { normalizeUrl } from './utils';

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
});

export async function fetchRssFeed(
  sourceId: string,
  feedUrl: string,
  maxItems?: number
): Promise<RawArticle[]> {
  try {
    const feed = await parser.parseURL(feedUrl);
    const articles: RawArticle[] = [];
    const items = maxItems ? feed.items.slice(0, maxItems) : feed.items;

    for (const item of items) {
      if (!item.title || !item.link) continue;

      articles.push({
        title: item.title,
        url: normalizeUrl(item.link),
        content: item.contentSnippet || item.content || item.summary || null,
        external_id: normalizeUrl(item.link),
        published_at: item.isoDate || item.pubDate || null,
        source_id: sourceId,
      });
    }

    return articles;
  } catch (error) {
    console.error(`Failed to fetch RSS feed ${feedUrl}:`, error);
    return [];
  }
}
