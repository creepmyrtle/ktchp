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

export function categorizeRssError(error: unknown): { status: string; message: string } {
  const msg = error instanceof Error ? error.message : String(error);

  // HTTP status code errors (e.g., "Status code 403")
  const statusMatch = msg.match(/status\s*code\s*(\d{3})/i);
  if (statusMatch) {
    return { status: `error_${statusMatch[1]}`, message: msg };
  }

  // Timeout errors
  if (/ETIMEDOUT|ECONNABORTED|timeout/i.test(msg)) {
    return { status: 'timeout', message: msg };
  }

  // Connection errors
  if (/ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return { status: 'connection_error', message: msg };
  }

  // Parse errors
  if (/parse|invalid xml|not a valid/i.test(msg)) {
    return { status: 'parse_error', message: msg };
  }

  return { status: 'unknown_error', message: msg };
}

export async function fetchRssFeed(
  sourceId: string,
  feedUrl: string,
  maxItems?: number
): Promise<RawArticle[]> {
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
}

export interface FeedValidationResult {
  valid: boolean;
  title: string | null;
  articles: Array<{
    title: string;
    url: string;
    content: string | null;
    published_at: string | null;
  }>;
  error: string | null;
}

export async function validateRssFeed(feedUrl: string): Promise<FeedValidationResult> {
  try {
    const feed = await parser.parseURL(feedUrl);
    const articles = feed.items
      .filter(item => item.title && item.link)
      .map(item => ({
        title: item.title!,
        url: item.link!,
        content: item.contentSnippet || item.content || item.summary || null,
        published_at: item.isoDate || item.pubDate || null,
      }));

    return {
      valid: true,
      title: feed.title || null,
      articles,
      error: null,
    };
  } catch (err) {
    const { message } = categorizeRssError(err);
    return {
      valid: false,
      title: null,
      articles: [],
      error: message,
    };
  }
}
