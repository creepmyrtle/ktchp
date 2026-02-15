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

  logger?.log('fetch', `Starting ingestion for ${sources.length} sources`, {
    sourceCount: sources.length,
    sources: sources.map(s => ({ id: s.id, name: s.name, type: s.type, url: s.config.url })),
  });

  // Fetch all sources in parallel
  const fetchStart = Date.now();
  const fetchResults = await Promise.allSettled(
    sources.map(async (source) => {
      const existingIds = await getRecentArticleExternalIds(source.id, provider);

      logger?.log('fetch', `Fetching source: ${source.name} (${source.type})`, {
        sourceId: source.id,
        url: source.config.url as string,
        existingArticleCount: existingIds.size,
      });

      const sourceStart = Date.now();
      const rawArticles = await fetchFromSource(source);
      const fetchDurationMs = Date.now() - sourceStart;

      logger?.log('fetch', `RSS fetched: ${source.name}`, {
        fetchDurationMs,
        itemCount: rawArticles.length,
      });

      return { source, rawArticles, existingIds };
    })
  );
  const totalFetchDurationMs = Date.now() - fetchStart;

  logger?.log('fetch', `All sources fetched in ${totalFetchDurationMs}ms`);

  // Process results sequentially (DB writes)
  for (const fetchResult of fetchResults) {
    if (fetchResult.status === 'rejected') {
      const msg = `Source fetch error: ${fetchResult.reason}`;
      console.error(msg);
      result.errors.push(msg);
      logger?.error('fetch', 'Source error', { error: String(fetchResult.reason) });
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
        logger?.log('fetch', `Duplicate skipped: "${raw.title}"`, {
          title: raw.title,
          url: raw.url,
          externalId: raw.external_id,
        });
        continue;
      }

      const article = await createArticle(raw, provider);
      if (article) {
        result.newArticles++;
        sourceNew++;
        logger?.log('fetch', `New article: "${raw.title}"`, {
          articleId: article.id,
          title: raw.title,
          url: raw.url,
          externalId: raw.external_id,
          publishedAt: raw.published_at,
        });
      } else {
        result.duplicates++;
        sourceDupes++;
        logger?.log('fetch', `DB duplicate: "${raw.title}"`, {
          title: raw.title,
          url: raw.url,
          externalId: raw.external_id,
        });
      }
    }

    logger?.log('fetch', `Source complete: ${source.name}`, {
      articlesFetched: rawArticles.length,
      new: sourceNew,
      duplicates: sourceDupes,
    });
  }

  logger?.log('fetch', 'Ingestion complete', {
    totalFetched: result.totalFetched,
    newArticles: result.newArticles,
    duplicates: result.duplicates,
    errorCount: result.errors.length,
  });

  return result;
}
