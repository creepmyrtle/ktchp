/**
 * Dry-run of the ingestion + scoring pipeline.
 * Fetches articles, prefilters, generates embeddings, and scores against
 * the admin user's interests — then saves everything to a local JSON file.
 * Does NOT write any articles, scores, or embeddings to the database.
 * (Only reads: sources, interests, and existing interest embeddings.)
 *
 * Usage: npx tsx scripts/fetch-preview.ts
 * Output: scripts/fetch-preview-output.json
 */

import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import 'tsconfig-paths/register';
import { getDefaultUser } from '@/lib/db/users';
import { getEnabledSourcesForUser } from '@/lib/db/sources';
import { getActiveInterestsByUserId } from '@/lib/db/interests';
import { getGlobalSetting } from '@/lib/db/settings';
import { fetchRssFeed } from '@/lib/ingestion/rss';
import { prefilterArticles } from '@/lib/relevance/prefilter';
import {
  generateEmbeddings,
  buildArticleEmbeddingText,
  buildInterestEmbeddingText,
  cosineSimilarity,
  getEmbedding,
} from '@/lib/embeddings';
import type { RawArticle, Article } from '@/types';

// ── Types for output ──

interface SourceFetchResult {
  name: string;
  url: string;
  articleCount: number;
  error: string | null;
}

interface PrefilterSummary {
  kept: number;
  removed: { reason: string; count: number }[];
  removedArticles: { title: string; url: string; reason: string }[];
}

interface ScoredArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  contentSnippet: string | null;
  embeddingText: string;
  rawSimilarity: number;
  weightedSimilarity: number;
  blendedScore: number;
  bestMatchInterest: string;
  allInterestScores: { interest: string; weight: number; rawSimilarity: number; weightedSimilarity: number }[];
}

interface DedupPair {
  duplicateTitle: string;
  originalTitle: string;
  similarity: number;
}

interface InterestInfo {
  category: string;
  description: string | null;
  weight: number;
  embeddingText: string;
  hadExistingEmbedding: boolean;
}

// ── Semantic dedup (same logic as ingestion pipeline) ──

const SEMANTIC_DEDUP_THRESHOLD = 0.85;

function semanticDedup(
  articles: { title: string }[],
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

  const keptIndices: number[] = [];
  for (let i = 0; i < articles.length; i++) {
    if (!duplicateIndices.has(i)) keptIndices.push(i);
  }
  return { keptIndices, duplicates };
}

// ── Main ──

async function main() {
  const admin = await getDefaultUser();
  if (!admin) {
    console.error('No admin user found.');
    process.exit(1);
  }
  console.log(`User: ${admin.username}\n`);

  // ── Load thresholds from DB (or code defaults) ──
  const [tLlm, tSerMin, tSerMax] = await Promise.all([
    getGlobalSetting('embedding_llm_threshold'),
    getGlobalSetting('embedding_serendipity_min'),
    getGlobalSetting('embedding_serendipity_max'),
  ]);
  const llmThreshold = tLlm ? parseFloat(tLlm) : 0.25;
  const serendipityMin = tSerMin ? parseFloat(tSerMin) : 0.12;
  const serendipityMax = tSerMax ? parseFloat(tSerMax) : 0.25;
  console.log(`Thresholds: LLM=${llmThreshold}, Serendipity=${serendipityMin}-${serendipityMax}\n`);

  // ── Step 1: Fetch ──
  console.log('─── STEP 1: FETCH ───');
  const sources = await getEnabledSourcesForUser(admin.id);
  console.log(`${sources.length} enabled sources\n`);

  const allRawArticles: (RawArticle & { sourceName: string })[] = [];
  const fetchResults: SourceFetchResult[] = [];

  for (const source of sources) {
    const url = source.config.url as string;
    process.stdout.write(`  ${source.name} ... `);
    try {
      const articles = await fetchRssFeed(source.id, url, source.max_items);
      for (const a of articles) {
        allRawArticles.push({ ...a, sourceName: source.name });
      }
      fetchResults.push({ name: source.name, url, articleCount: articles.length, error: null });
      console.log(`${articles.length} articles`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fetchResults.push({ name: source.name, url, articleCount: 0, error: msg });
      console.log(`ERROR: ${msg}`);
    }
  }

  console.log(`\nTotal fetched: ${allRawArticles.length}\n`);

  // ── Step 2: Prefilter ──
  console.log('─── STEP 2: PREFILTER ───');

  // Convert RawArticles to Article shape for prefilter (it just needs title, url, published_at)
  const asArticles: (Article & { sourceName: string })[] = allRawArticles.map((r) => ({
    id: r.external_id || r.url,
    source_id: r.source_id,
    external_id: r.external_id,
    title: r.title,
    url: r.url,
    raw_content: r.content,
    summary: null,
    provider: 'preview',
    published_at: r.published_at,
    ingested_at: new Date().toISOString(),
    sourceName: r.sourceName,
  }));

  const { kept, removed } = prefilterArticles(asArticles, {
    userCreatedAt: admin.created_at ? new Date(admin.created_at) : undefined,
  });

  const reasonCounts = new Map<string, number>();
  for (const r of removed) {
    reasonCounts.set(r.reason, (reasonCounts.get(r.reason) || 0) + 1);
  }

  const prefilterSummary: PrefilterSummary = {
    kept: kept.length,
    removed: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })),
    removedArticles: removed,
  };

  console.log(`  Kept: ${kept.length}`);
  for (const [reason, count] of reasonCounts) {
    console.log(`  Removed (${reason}): ${count}`);
  }
  console.log();

  if (kept.length === 0) {
    console.log('No articles survived prefilter. Saving output and exiting.');
    await saveOutput({ fetchResults, prefilterSummary, interests: [], scored: [], dedupPairs: [], embeddingTokens: 0, llmThreshold, serendipityMin });
    process.exit(0);
  }

  // ── Step 3: Embedding scoring ──
  console.log('─── STEP 3: EMBEDDING SCORING ───');

  // Get interests + their embeddings
  const interests = await getActiveInterestsByUserId(admin.id);
  console.log(`  ${interests.length} active interests`);

  const interestInfos: InterestInfo[] = [];
  const interestEmbeddings: { interest: string; weight: number; embedding: number[] }[] = [];

  for (const interest of interests) {
    const embText = buildInterestEmbeddingText(interest.category, interest.description);
    const existing = await getEmbedding('interest', interest.id);

    if (existing) {
      interestEmbeddings.push({ interest: interest.category, weight: interest.weight, embedding: existing });
      interestInfos.push({ category: interest.category, description: interest.description, weight: interest.weight, embeddingText: embText, hadExistingEmbedding: true });
    } else {
      // Generate embedding on the fly (not stored)
      console.log(`  Generating embedding for interest: ${interest.category}`);
      const { embeddings } = await generateEmbeddings([embText]);
      interestEmbeddings.push({ interest: interest.category, weight: interest.weight, embedding: embeddings[0] });
      interestInfos.push({ category: interest.category, description: interest.description, weight: interest.weight, embeddingText: embText, hadExistingEmbedding: false });
    }
  }

  // Build source name lookup from the kept articles
  const sourceNameMap = new Map<string, string>();
  for (const a of allRawArticles) {
    sourceNameMap.set(a.source_id, a.sourceName);
  }

  // Generate article embeddings (not stored)
  const articleTexts = kept.map((a) => buildArticleEmbeddingText(a.title, a.raw_content));
  console.log(`  Generating embeddings for ${kept.length} articles...`);
  const { embeddings: articleEmbeddings, totalTokens } = await generateEmbeddings(articleTexts);
  console.log(`  Done (${totalTokens.toLocaleString()} tokens)\n`);

  // ── Step 2.5: Semantic Dedup ──
  console.log('─── STEP 2.5: SEMANTIC DEDUP ───');
  const { keptIndices, duplicates: dedupResults } = semanticDedup(kept, articleEmbeddings, SEMANTIC_DEDUP_THRESHOLD);
  const dedupPairs: DedupPair[] = dedupResults.map((d) => ({
    duplicateTitle: kept[d.index].title,
    originalTitle: kept[d.duplicateOfIndex].title,
    similarity: d.similarity,
  }));

  if (dedupResults.length > 0) {
    console.log(`  Found ${dedupResults.length} semantic duplicate(s):`);
    for (const pair of dedupPairs) {
      console.log(`    "${pair.duplicateTitle.slice(0, 55)}" ≈ "${pair.originalTitle.slice(0, 55)}" (${pair.similarity.toFixed(3)})`);
    }
  } else {
    console.log('  No semantic duplicates found');
  }

  // Filter to non-duplicate articles for scoring
  const keptAfterDedup = keptIndices.map((i) => ({ article: kept[i], embedding: articleEmbeddings[i], textIdx: i }));
  console.log(`  ${kept.length} → ${keptAfterDedup.length} after dedup\n`);

  // Score each article against all interests (with weighted + blended scoring)
  const scored: ScoredArticle[] = [];

  for (const { article: rawArticle, embedding: articleEmb, textIdx } of keptAfterDedup) {
    const article = rawArticle as Article & { sourceName: string };

    const allScores = interestEmbeddings.map((ie) => {
      const rawSim = cosineSimilarity(articleEmb, ie.embedding);
      return {
        interest: ie.interest,
        weight: ie.weight,
        rawSimilarity: rawSim,
        weightedSimilarity: rawSim * ie.weight,
      };
    });

    // Raw max similarity (old scoring)
    const rawMax = Math.max(...allScores.map((s) => s.rawSimilarity), 0);

    // Weighted similarities for blended scoring (skip weight-0 interests)
    const weightedSims = allScores
      .filter((s) => s.weight > 0)
      .map((s) => s.weightedSimilarity)
      .sort((a, b) => b - a);

    const primary = weightedSims[0] ?? 0;
    const topN = weightedSims.slice(0, 3);
    const secondary = topN.length > 0 ? topN.reduce((s, v) => s + v, 0) / topN.length : 0;
    const blended = 0.7 * primary + 0.3 * secondary;

    // Best match by weighted similarity
    allScores.sort((a, b) => b.weightedSimilarity - a.weightedSimilarity);
    const best = allScores[0];

    scored.push({
      title: article.title,
      url: article.url,
      source: article.sourceName || sourceNameMap.get(article.source_id) || 'Unknown',
      publishedAt: article.published_at,
      contentSnippet: article.raw_content ? article.raw_content.slice(0, 500) : null,
      embeddingText: articleTexts[textIdx],
      rawSimilarity: rawMax,
      weightedSimilarity: primary,
      blendedScore: blended,
      bestMatchInterest: best?.interest ?? 'none',
      allInterestScores: allScores,
    });
  }

  // Sort by blended score descending
  scored.sort((a, b) => b.blendedScore - a.blendedScore);

  // Print top articles
  console.log('─── TOP 15 BY BLENDED SCORE ───');
  for (const a of scored.slice(0, 15)) {
    console.log(`  ${a.blendedScore.toFixed(3)}  (raw: ${a.rawSimilarity.toFixed(3)})  [${a.bestMatchInterest}]  ${a.title.slice(0, 60)}`);
  }

  // Print threshold breakdown (using blended scores)
  const aboveLlm = scored.filter((a) => a.blendedScore >= llmThreshold).length;
  const serendipityPool = scored.filter((a) => a.blendedScore >= serendipityMin && a.blendedScore < llmThreshold).length;
  const belowFloor = scored.filter((a) => a.blendedScore < serendipityMin).length;

  console.log(`\n  Above LLM threshold (>=${llmThreshold}): ${aboveLlm} -> would go to LLM scoring`);
  console.log(`  Serendipity pool (${serendipityMin}-${llmThreshold}): ${serendipityPool} -> random 5 would go to LLM`);
  console.log(`  Below floor (<${serendipityMin}): ${belowFloor} -> skipped`);

  // ── Before/After comparison ──
  console.log('\n─── BEFORE/AFTER COMPARISON (top 15) ───');
  console.log('  Old (raw max) vs New (weighted blended)\n');

  // Rank by old scoring
  const oldRanked = [...scored].sort((a, b) => b.rawSimilarity - a.rawSimilarity);
  const oldRankMap = new Map<string, number>();
  oldRanked.forEach((a, i) => oldRankMap.set(a.url, i + 1));

  // Rank by new scoring
  const newRankMap = new Map<string, number>();
  scored.forEach((a, i) => newRankMap.set(a.url, i + 1));

  console.log('  #New  #Old  Chg   Blended  Raw      Title');
  console.log('  ────  ────  ───   ───────  ───      ─────');
  for (let i = 0; i < Math.min(15, scored.length); i++) {
    const a = scored[i];
    const newRank = i + 1;
    const oldRank = oldRankMap.get(a.url) ?? 0;
    const change = oldRank - newRank;
    const changeStr = change > 0 ? `+${change}`.padStart(3) : change < 0 ? `${change}`.padStart(3) : '  =';
    console.log(
      `  ${String(newRank).padStart(4)}  ${String(oldRank).padStart(4)}  ${changeStr}   ${a.blendedScore.toFixed(3)}    ${a.rawSimilarity.toFixed(3)}    ${a.title.slice(0, 45)}`
    );
  }

  await saveOutput({ fetchResults, prefilterSummary, interests: interestInfos, scored, dedupPairs, embeddingTokens: totalTokens, llmThreshold, serendipityMin });
}

async function saveOutput(data: {
  fetchResults: SourceFetchResult[];
  prefilterSummary: PrefilterSummary;
  interests: InterestInfo[];
  scored: ScoredArticle[];
  dedupPairs: DedupPair[];
  embeddingTokens: number;
  llmThreshold: number;
  serendipityMin: number;
}) {
  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      sourcesFetched: data.fetchResults.length,
      sourcesWithErrors: data.fetchResults.filter((r) => r.error).length,
      articlesFetched: data.fetchResults.reduce((s, r) => s + r.articleCount, 0),
      afterPrefilter: data.prefilterSummary.kept,
      semanticDuplicatesFound: data.dedupPairs.length,
      afterDedup: data.scored.length,
      embeddingTokensUsed: data.embeddingTokens,
      aboveLlmThreshold: data.scored.filter((a) => a.blendedScore >= data.llmThreshold).length,
      serendipityPool: data.scored.filter((a) => a.blendedScore >= data.serendipityMin && a.blendedScore < data.llmThreshold).length,
    },
    fetchResults: data.fetchResults,
    prefilter: data.prefilterSummary,
    semanticDedup: data.dedupPairs,
    interests: data.interests,
    scoredArticles: data.scored,
  };

  const outPath = resolve(process.cwd(), 'scripts/fetch-preview-output.json');
  await writeFile(outPath, JSON.stringify(output, null, 2));

  console.log(`\nSaved to ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
