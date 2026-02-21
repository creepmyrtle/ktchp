import OpenAI from 'openai';
import { sql } from '@vercel/postgres';
import { config } from './config';

// --- pgvector detection ---

let pgvectorAvailable: boolean | null = null;

async function detectPgvector(): Promise<boolean> {
  if (pgvectorAvailable !== null) return pgvectorAvailable;

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    pgvectorAvailable = true;
    console.log('pgvector extension enabled — using native vector storage');
  } catch {
    pgvectorAvailable = false;
    console.warn('pgvector not available — falling back to JSONB storage with application-level similarity');
  }
  return pgvectorAvailable;
}

// --- Embedding generation (OpenAI) ---

function getClient(): OpenAI {
  return new OpenAI({ apiKey: config.openaiApiKey });
}

export interface EmbeddingResult {
  embeddings: number[][];
  totalTokens: number;
}

export async function generateEmbeddings(texts: string[]): Promise<EmbeddingResult> {
  if (texts.length === 0) return { embeddings: [], totalTokens: 0 };

  const client = getClient();
  // OpenAI batches up to 2048 texts per call. Batch aggressively.
  const allEmbeddings: number[][] = [];
  let totalTokens = 0;

  for (let i = 0; i < texts.length; i += 2048) {
    const batch = texts.slice(i, i + 2048);
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
      dimensions: 512,
    });
    for (const item of response.data) {
      allEmbeddings.push(item.embedding);
    }
    totalTokens += response.usage?.total_tokens ?? 0;
  }

  return { embeddings: allEmbeddings, totalTokens };
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const { embeddings } = await generateEmbeddings([text]);
  return embeddings[0];
}

// --- Cosine similarity (application-level fallback) ---

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- Storage layer (pgvector or JSONB, auto-detected) ---

export async function storeEmbedding(
  refType: 'article' | 'interest' | 'exclusion',
  refId: string,
  embeddingText: string,
  embedding: number[]
): Promise<void> {
  const usePgvector = await detectPgvector();

  if (usePgvector) {
    const vectorStr = `[${embedding.join(',')}]`;
    await sql.query(
      `INSERT INTO embeddings (ref_type, ref_id, embedding_text, embedding)
       VALUES ($1, $2, $3, $4::vector)
       ON CONFLICT (ref_type, ref_id) DO UPDATE SET
         embedding_text = $3,
         embedding = $4::vector,
         created_at = CURRENT_TIMESTAMP`,
      [refType, refId, embeddingText, vectorStr]
    );
  } else {
    await sql.query(
      `INSERT INTO embeddings (ref_type, ref_id, embedding_text, embedding_json)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (ref_type, ref_id) DO UPDATE SET
         embedding_text = $3,
         embedding_json = $4,
         created_at = CURRENT_TIMESTAMP`,
      [refType, refId, embeddingText, JSON.stringify(embedding)]
    );
  }
}

export async function getEmbedding(
  refType: 'article' | 'interest' | 'exclusion',
  refId: string
): Promise<number[] | null> {
  const usePgvector = await detectPgvector();

  if (usePgvector) {
    const { rows } = await sql`
      SELECT embedding::text FROM embeddings WHERE ref_type = ${refType} AND ref_id = ${refId}
    `;
    if (!rows[0]) return null;
    // pgvector returns "[0.1,0.2,...]" as text
    return JSON.parse(rows[0].embedding);
  } else {
    const { rows } = await sql`
      SELECT embedding_json FROM embeddings WHERE ref_type = ${refType} AND ref_id = ${refId}
    `;
    if (!rows[0]) return null;
    return rows[0].embedding_json as number[];
  }
}

export async function getEmbeddingsByType(
  refType: 'article' | 'interest' | 'exclusion',
  refIds: string[]
): Promise<Map<string, number[]>> {
  if (refIds.length === 0) return new Map();

  const usePgvector = await detectPgvector();
  const placeholders = refIds.map((_, i) => `$${i + 2}`).join(', ');
  const result = new Map<string, number[]>();

  if (usePgvector) {
    const { rows } = await sql.query(
      `SELECT ref_id, embedding::text FROM embeddings WHERE ref_type = $1 AND ref_id IN (${placeholders})`,
      [refType, ...refIds]
    );
    for (const row of rows) {
      result.set(row.ref_id, JSON.parse(row.embedding));
    }
  } else {
    const { rows } = await sql.query(
      `SELECT ref_id, embedding_json FROM embeddings WHERE ref_type = $1 AND ref_id IN (${placeholders})`,
      [refType, ...refIds]
    );
    for (const row of rows) {
      result.set(row.ref_id, row.embedding_json as number[]);
    }
  }

  return result;
}

export async function deleteEmbedding(
  refType: 'article' | 'interest' | 'exclusion',
  refId: string
): Promise<void> {
  await sql`DELETE FROM embeddings WHERE ref_type = ${refType} AND ref_id = ${refId}`;
}

export async function getArticleIdsWithEmbeddings(articleIds: string[]): Promise<Set<string>> {
  if (articleIds.length === 0) return new Set();

  const placeholders = articleIds.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await sql.query(
    `SELECT ref_id FROM embeddings WHERE ref_type = 'article' AND ref_id IN (${placeholders})`,
    articleIds
  );
  return new Set(rows.map(r => r.ref_id));
}

// --- Pruning ---

export async function pruneOldArticleEmbeddings(daysOld: number = 7): Promise<number> {
  const { rowCount } = await sql`
    DELETE FROM embeddings
    WHERE ref_type = 'article'
      AND created_at < NOW() - INTERVAL '1 day' * ${daysOld}
  `;
  return rowCount ?? 0;
}

// --- Interest embedding text builder ---

export function buildInterestEmbeddingText(category: string, description: string | null, expandedDescription?: string | null): string {
  if (expandedDescription) return expandedDescription;
  return description ? `${category}: ${description}` : category;
}

// --- Article embedding text builder ---

export function buildArticleEmbeddingText(title: string, rawContent: string | null): string {
  if (rawContent) {
    return `${title}. ${rawContent.slice(0, 500)}`;
  }
  return title;
}
