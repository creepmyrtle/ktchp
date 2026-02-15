import type { Source, RawArticle } from '@/types';
import { getEnabledSourcesByUserId } from '../db/sources';
import { createArticle, getRecentArticleExternalIds } from '../db/articles';
import { fetchRssFeed } from './rss';
import type { IngestionLogger } from './logger';

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

export async function runIngestion(userId: string, provider: string, logger?: IngestionLogger): Promise<IngestionResult> {
  const sources = await getEnabledSourcesByUserId(userId);
  const result: IngestionResult = {
    totalFetched: 0,
    newArticles: 0,
    duplicates: 0,
    errors: [],
  };

  logger?.log('fetch', `Starting ingestion for ${sources.length} sources`);

  for (const source of sources) {
    try {
      logger?.log('fetch', `Fetching source: ${source.name} (${source.type})`, {
        sourceId: source.id,
        url: source.config.url as string,
      });

      const existingIds = await getRecentArticleExternalIds(source.id, provider);

      const rawArticles = await fetchFromSource(source);
      result.totalFetched += rawArticles.length;

      let sourceNew = 0;
      let sourceDupes = 0;

      for (const raw of rawArticles) {
        if (raw.external_id && existingIds.has(raw.external_id)) {
          result.duplicates++;
          sourceDupes++;
          continue;
        }

        const article = await createArticle(raw, provider);
        if (article) {
          result.newArticles++;
          sourceNew++;
        } else {
          result.duplicates++;
          sourceDupes++;
        }
      }

      logger?.log('fetch', `Source complete: ${source.name}`, {
        articlesFetched: rawArticles.length,
        new: sourceNew,
        duplicates: sourceDupes,
      });
    } catch (error) {
      const msg = `Error fetching ${source.name}: ${error}`;
      console.error(msg);
      result.errors.push(msg);
      logger?.error('fetch', `Source error: ${source.name}`, {
        error: String(error),
      });
    }
  }

  logger?.log('fetch', 'Ingestion complete', {
    totalFetched: result.totalFetched,
    newArticles: result.newArticles,
    duplicates: result.duplicates,
    errorCount: result.errors.length,
  });

  return result;
}
