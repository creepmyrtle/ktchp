import type { Article } from '@/types';

const SPAM_DOMAINS = [
  'bit.ly', 't.co', 'tinyurl.com',
  'clickbait.example.com',
];

const MIN_TITLE_LENGTH = 10;
const FRESHNESS_CUTOFF_HOURS = 7 * 24; // 7 days

export function prefilterArticles(articles: Article[]): Article[] {
  const seen = new Set<string>();

  return articles.filter(article => {
    // Remove very short titles
    if (article.title.length < MIN_TITLE_LENGTH) return false;

    // Remove known spam domains
    try {
      const hostname = new URL(article.url).hostname;
      if (SPAM_DOMAINS.some(d => hostname.includes(d))) return false;
    } catch {
      // Invalid URL, skip
      return false;
    }

    // Exact title dedup
    const titleKey = article.title.toLowerCase().trim();
    if (seen.has(titleKey)) return false;
    seen.add(titleKey);

    // Content freshness check (7 days)
    if (article.published_at) {
      const publishedAt = new Date(article.published_at).getTime();
      const cutoff = Date.now() - FRESHNESS_CUTOFF_HOURS * 60 * 60 * 1000;
      if (publishedAt < cutoff) return false;
    }

    return true;
  });
}
