import type { Source, RawArticle } from '@/types';
import { getAllFetchableSources } from '../db/sources';
import { createArticle, getRecentArticleExternalIds } from '../db/articles';
import { fetchRssFeed } from './rss';
import {
  generateEmbeddings,
  storeEmbedding,
  getArticleIdsWithEmbeddings,
  buildArticleEmbeddingText,
} from '../embeddings';
import type { IngestionLogger } from './logger';

interface IngestionResult {
  totalFetched: number;
  newArticles: number;
  duplicates: number;
  articlesEmbedded: number;
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
    articlesEmbedded: 0,
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

  // Track new articles for embedding
  const newArticleData: { id: string; title: string; rawContent: string | null }[] = [];

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
        newArticleData.push({ id: article.id, title: article.title, rawContent: article.raw_content });
      } else {
        result.duplicates++;
        sourceDupes++;
      }
    }

    logger?.log('fetch', `${source.name}: ${sourceNew} new, ${sourceDupes} dupes (${rawArticles.length} fetched)`);
  }

  logger?.log('fetch', `Ingestion done: ${result.newArticles} new, ${result.duplicates} dupes, ${result.errors.length} errors`);

  // Embed new articles that don't already have embeddings
  if (newArticleData.length > 0) {
    result.articlesEmbedded = await embedNewArticles(newArticleData, logger);
  }

  return result;
}

async function embedNewArticles(
  articles: { id: string; title: string; rawContent: string | null }[],
  logger?: IngestionLogger
): Promise<number> {
  try {
    // Filter out articles that already have embeddings (shouldn't happen for new articles, but be safe)
    const existingIds = await getArticleIdsWithEmbeddings(articles.map(a => a.id));
    const toEmbed = articles.filter(a => !existingIds.has(a.id));

    if (toEmbed.length === 0) {
      logger?.log('embedding', 'All articles already have embeddings');
      return 0;
    }

    logger?.log('embedding', `Generating embeddings for ${toEmbed.length} new articles`);

    const texts = toEmbed.map(a => buildArticleEmbeddingText(a.title, a.rawContent));
    const embeddings = await generateEmbeddings(texts);

    for (let i = 0; i < toEmbed.length; i++) {
      await storeEmbedding('article', toEmbed[i].id, texts[i], embeddings[i]);
    }

    logger?.log('embedding', `Embedded ${toEmbed.length} articles`);
    return toEmbed.length;
  } catch (error) {
    logger?.warn('embedding', `Article embedding failed (will fall back to LLM-only scoring): ${error}`);
    return 0;
  }
}
