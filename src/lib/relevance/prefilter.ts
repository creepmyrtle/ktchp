import type { Article } from '@/types';

const SPAM_DOMAINS = [
  'bit.ly', 't.co', 'tinyurl.com',
  'clickbait.example.com',
];

const MIN_TITLE_LENGTH = 10;
const FRESHNESS_CUTOFF_HOURS = 7 * 24; // 7 days

export interface PrefilterRemoval {
  title: string;
  url: string;
  reason: 'short_title' | 'spam_domain' | 'invalid_url' | 'title_dupe' | 'stale';
}

export interface PrefilterResult {
  kept: Article[];
  removed: PrefilterRemoval[];
}

export function prefilterArticles(articles: Article[]): PrefilterResult {
  const seen = new Set<string>();
  const kept: Article[] = [];
  const removed: PrefilterRemoval[] = [];

  for (const article of articles) {
    // Remove very short titles
    if (article.title.length < MIN_TITLE_LENGTH) {
      removed.push({ title: article.title, url: article.url, reason: 'short_title' });
      continue;
    }

    // Remove known spam domains
    let hostname: string;
    try {
      hostname = new URL(article.url).hostname;
    } catch {
      removed.push({ title: article.title, url: article.url, reason: 'invalid_url' });
      continue;
    }
    if (SPAM_DOMAINS.some(d => hostname.includes(d))) {
      removed.push({ title: article.title, url: article.url, reason: 'spam_domain' });
      continue;
    }

    // Exact title dedup
    const titleKey = article.title.toLowerCase().trim();
    if (seen.has(titleKey)) {
      removed.push({ title: article.title, url: article.url, reason: 'title_dupe' });
      continue;
    }
    seen.add(titleKey);

    // Content freshness check (7 days)
    if (article.published_at) {
      const publishedAt = new Date(article.published_at).getTime();
      const cutoff = Date.now() - FRESHNESS_CUTOFF_HOURS * 60 * 60 * 1000;
      if (publishedAt < cutoff) {
        removed.push({ title: article.title, url: article.url, reason: 'stale' });
        continue;
      }
    }

    kept.push(article);
  }

  return { kept, removed };
}
