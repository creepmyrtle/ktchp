import type { Article } from '@/types';

const SPAM_DOMAINS = [
  'bit.ly', 't.co', 'tinyurl.com',
];

const MIN_TITLE_LENGTH = 4;
const FRESHNESS_CUTOFF_HOURS = 14 * 24; // 14 days
const NEW_USER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export interface PrefilterRemoval {
  title: string;
  url: string;
  reason: 'short_title' | 'spam_domain' | 'invalid_url' | 'title_dupe' | 'stale';
}

export interface PrefilterResult {
  kept: Article[];
  removed: PrefilterRemoval[];
}

export interface PrefilterOptions {
  /** When the user's account was created. Used to extend the stale window for new users. */
  userCreatedAt?: Date;
}

export function prefilterArticles(articles: Article[], options?: PrefilterOptions): PrefilterResult {
  const seen = new Set<string>();
  const kept: Article[] = [];
  const removed: PrefilterRemoval[] = [];

  // For new users (account < 14 days old), consider articles from 14 days before
  // their account creation as fresh. After 14 days on the platform, normal stale filter applies.
  let staleCutoff: number;
  if (options?.userCreatedAt) {
    const accountAgeMs = Date.now() - options.userCreatedAt.getTime();
    if (accountAgeMs < NEW_USER_WINDOW_MS) {
      // New user: articles from 14 days before account creation are fresh
      staleCutoff = options.userCreatedAt.getTime() - FRESHNESS_CUTOFF_HOURS * 60 * 60 * 1000;
    } else {
      staleCutoff = Date.now() - FRESHNESS_CUTOFF_HOURS * 60 * 60 * 1000;
    }
  } else {
    staleCutoff = Date.now() - FRESHNESS_CUTOFF_HOURS * 60 * 60 * 1000;
  }

  for (const article of articles) {
    // Remove very short titles (empty or single-character — genuinely broken data)
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
    if (SPAM_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) {
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

    // Content freshness check
    if (article.published_at) {
      const publishedAt = new Date(article.published_at).getTime();
      if (publishedAt < staleCutoff) {
        removed.push({ title: article.title, url: article.url, reason: 'stale' });
        continue;
      }
    }

    kept.push(article);
  }

  return { kept, removed };
}
