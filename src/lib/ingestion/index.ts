import type { Source, RawArticle } from '@/types';
import { getAllFetchableSources } from '../db/sources';
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
      return fetchRssFeed(source.id, cfg.url as string, source.max_items);

    default:
      return [];
  }
}

export async function runIngestion(provider: string, logger?: IngestionLogger): Promise<IngestionResult> {
  const sources = await getAllFetchableSources();
  const result: IngestionResult = {
    totalFetched: 0,
    newArticles: 0,
    duplicates: 0,
    errors: [],
  };

  logger?.log('fetch', `Fetching from ${sources.length} sources`);

  // Fetch all sources in parallel
  const fetchResults = await Promise.allSettled(
    sources.map(async (source) => {
      const existingIds = await getRecentArticleExternalIds(source.id, provider);
      const rawArticles = await fetchFromSource(source);
      return { source, rawArticles, existingIds };
    })
  );

  // Process results sequentially (DB writes)
  for (const fetchResult of fetchResults) {
    if (fetchResult.status === 'rejected') {
      const msg = `Source fetch error: ${fetchResult.reason}`;
      console.error(msg);
      result.errors.push(msg);
      logger?.error('fetch', `Source error: ${fetchResult.reason}`);
      continue;
    }

    const { source, rawArticles, existingIds } = fetchResult.value;
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

    logger?.log('fetch', `${source.name}: ${sourceNew} new, ${sourceDupes} dupes (${rawArticles.length} fetched)`);
  }

  logger?.log('fetch', `Ingestion done: ${result.newArticles} new, ${result.duplicates} dupes, ${result.errors.length} errors`);

  return result;
}
