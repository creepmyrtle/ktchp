import type { Source, RawArticle } from '@/types';
import { getAllFetchableSources, updateSourceFetchStatus } from '../db/sources';
import { createArticle, getRecentArticleExternalIds } from '../db/articles';
import { fetchRssFeed, categorizeRssError } from './rss';
import {
  generateEmbeddings,
  storeEmbedding,
  getArticleIdsWithEmbeddings,
  buildArticleEmbeddingText,
  cosineSimilarity,
} from '../embeddings';
import { markSemanticDuplicate } from '../db/articles';
import type { IngestionLogger } from './logger';

interface IngestionResult {
  totalFetched: number;
  newArticles: number;
  duplicates: number;
  semanticDuplicates: number;
  articlesEmbedded: number;
  embeddingTokens: number;
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
    semanticDuplicates: 0,
    articlesEmbedded: 0,
    embeddingTokens: 0,
    errors: [],
  };

  logger?.log('fetch', `Fetching from ${sources.length} sources`);

  // Fetch all sources in parallel, handling errors per-source
  const fetchResults = await Promise.all(
    sources.map(async (source) => {
      try {
        const existingIds = await getRecentArticleExternalIds(source.id, provider);
        const rawArticles = await fetchFromSource(source);
        return { source, rawArticles, existingIds, error: null as string | null };
      } catch (err) {
        const { status, message } = categorizeRssError(err);
        await updateSourceFetchStatus(source.id, message, status);
        return { source, rawArticles: [] as RawArticle[], existingIds: new Set<string>(), error: message };
      }
    })
  );

  // Track new articles for embedding
  const newArticleData: { id: string; title: string; rawContent: string | null }[] = [];

  // Process results sequentially (DB writes)
  for (const fetchResult of fetchResults) {
    if (fetchResult.error) {
      const msg = `Source fetch error (${fetchResult.source.name}): ${fetchResult.error}`;
      console.error(msg);
      result.errors.push(msg);
      logger?.error('fetch', `${fetchResult.source.name}: ${fetchResult.error}`);
      continue;
    }

    const { source, rawArticles, existingIds } = fetchResult;
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

    await updateSourceFetchStatus(source.id, null, 'ok', sourceNew);
    logger?.log('fetch', `${source.name}: ${sourceNew} new, ${sourceDupes} dupes (${rawArticles.length} fetched)`);
  }

  logger?.log('fetch', `Ingestion done: ${result.newArticles} new, ${result.duplicates} dupes, ${result.errors.length} errors`);

  // Embed new articles that don't already have embeddings
  if (newArticleData.length > 0) {
    const embedResult = await embedNewArticles(newArticleData, logger);
    result.articlesEmbedded = embedResult.count;
    result.embeddingTokens = embedResult.tokens;
    result.semanticDuplicates = embedResult.semanticDuplicates;
  }

  return result;
}

const SEMANTIC_DEDUP_THRESHOLD = 0.85;

function semanticDedup(
  articles: { id: string; title: string; rawContent: string | null }[],
  embeddings: number[][],
  threshold: number
): { keptIndices: number[]; duplicates: { index: number; duplicateOfIndex: number; similarity: number }[] } {
  const duplicates: { index: number; duplicateOfIndex: number; similarity: number }[] = [];
  const duplicateIndices = new Set<number>();

  for (let i = 0; i < embeddings.length; i++) {
    if (duplicateIndices.has(i)) continue;
    for (let j = i + 1; j < embeddings.length; j++) {
      if (duplicateIndices.has(j)) continue;
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      if (sim >= threshold) {
        duplicateIndices.add(j);
        duplicates.push({ index: j, duplicateOfIndex: i, similarity: sim });
      }
    }
  }

  const keptIndices = [];
  for (let i = 0; i < articles.length; i++) {
    if (!duplicateIndices.has(i)) keptIndices.push(i);
  }
  return { keptIndices, duplicates };
}

async function embedNewArticles(
  articles: { id: string; title: string; rawContent: string | null }[],
  logger?: IngestionLogger
): Promise<{ count: number; tokens: number; semanticDuplicates: number }> {
  try {
    // Filter out articles that already have embeddings (shouldn't happen for new articles, but be safe)
    const existingIds = await getArticleIdsWithEmbeddings(articles.map(a => a.id));
    const toEmbed = articles.filter(a => !existingIds.has(a.id));

    if (toEmbed.length === 0) {
      logger?.log('embedding', 'All articles already have embeddings');
      return { count: 0, tokens: 0, semanticDuplicates: 0 };
    }

    logger?.log('embedding', `Generating embeddings for ${toEmbed.length} new articles`);

    const texts = toEmbed.map(a => buildArticleEmbeddingText(a.title, a.rawContent));
    const { embeddings, totalTokens } = await generateEmbeddings(texts);

    // Store all embeddings (duplicates still get embeddings)
    for (let i = 0; i < toEmbed.length; i++) {
      await storeEmbedding('article', toEmbed[i].id, texts[i], embeddings[i]);
    }

    // Semantic dedup: mark later articles as duplicates of earlier ones
    const { duplicates } = semanticDedup(toEmbed, embeddings, SEMANTIC_DEDUP_THRESHOLD);
    for (const dup of duplicates) {
      await markSemanticDuplicate(toEmbed[dup.index].id, toEmbed[dup.duplicateOfIndex].id);
    }

    if (duplicates.length > 0) {
      logger?.log('dedup', `Marked ${duplicates.length} semantic duplicate(s)`);
      for (const dup of duplicates) {
        logger?.log('dedup', `  "${toEmbed[dup.index].title.slice(0, 60)}" ≈ "${toEmbed[dup.duplicateOfIndex].title.slice(0, 60)}" (${dup.similarity.toFixed(3)})`);
      }
    }

    logger?.log('embedding', `Embedded ${toEmbed.length} articles (${totalTokens.toLocaleString()} tokens)`);
    return { count: toEmbed.length, tokens: totalTokens, semanticDuplicates: duplicates.length };
  } catch (error) {
    logger?.warn('embedding', `Article embedding failed (will fall back to LLM-only scoring): ${error}`);
    return { count: 0, tokens: 0, semanticDuplicates: 0 };
  }
}
