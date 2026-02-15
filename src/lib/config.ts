export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  syntheticApiKey: process.env.SYNTHETIC_API_KEY || '',
  cronSecret: process.env.CRON_SECRET || '',
  minRelevanceScore: parseFloat(process.env.MIN_RELEVANCE_SCORE || '0.5'),
  claudeModel: 'claude-sonnet-4-20250514' as const,
  syntheticModel: 'hf:moonshotai/Kimi-K2.5',
  batchSize: 10,
};
