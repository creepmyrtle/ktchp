import type { Source, RawArticle } from '@/types';
import { getEnabledSourcesByUserId } from '../db/sources';
import { createArticle, getRecentArticleExternalIds } from '../db/articles';
import { fetchRssFeed } from './rss';

interface IngestionResult {
  totalFetched: number;
  newArticles: number;
  duplicates: number;
  errors: string[];
}

async function fetchFromSource(source: Source): Promise<RawArticle[]> {
  const cfg = source.config;

  switch (source.type) {
    case 'rss':
      return fetchRssFeed(source.id, cfg.url as string);

    default:
      return [];
  }
}

export async function runIngestion(userId: string, provider: string): Promise<IngestionResult> {
  const sources = await getEnabledSourcesByUserId(userId);
  const result: IngestionResult = {
    totalFetched: 0,
    newArticles: 0,
    duplicates: 0,
    errors: [],
  };

  for (const source of sources) {
    try {
      const existingIds = await getRecentArticleExternalIds(source.id, provider);

      const rawArticles = await fetchFromSource(source);
      result.totalFetched += rawArticles.length;

      for (const raw of rawArticles) {
        if (raw.external_id && existingIds.has(raw.external_id)) {
          result.duplicates++;
          continue;
        }

        const article = await createArticle(raw, provider);
        if (article) {
          result.newArticles++;
        } else {
          result.duplicates++;
        }
      }
    } catch (error) {
      const msg = `Error fetching ${source.name}: ${error}`;
      console.error(msg);
      result.errors.push(msg);
    }
  }

  return result;
}
