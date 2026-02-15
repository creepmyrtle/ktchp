export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  syntheticApiKey: process.env.SYNTHETIC_API_KEY || '',
  digestPassword: process.env.DIGEST_PASSWORD || '',
  cronSecret: process.env.CRON_SECRET || '',
  digestTimes: (process.env.DIGEST_TIMES || '07:00,17:00').split(','),
  maxArticlesPerDigest: parseInt(process.env.MAX_ARTICLES_PER_DIGEST || '50', 10),
  minRelevanceScore: parseFloat(process.env.MIN_RELEVANCE_SCORE || '0.5'),
  claudeModel: 'claude-sonnet-4-20250514' as const,
  syntheticModel: 'hf:moonshotai/Kimi-K2.5',
  batchSize: 10,
  freshnessCutoffHours: 48,
};
