export const config = {
  get anthropicApiKey() { return process.env.ANTHROPIC_API_KEY || ''; },
  get syntheticApiKey() { return process.env.SYNTHETIC_API_KEY || ''; },
  get openaiApiKey() { return process.env.OPENAI_API_KEY || ''; },
  get cronSecret() { return process.env.CRON_SECRET || ''; },
  get minRelevanceScore() { return parseFloat(process.env.MIN_RELEVANCE_SCORE || '0.5'); },
  claudeModel: 'claude-sonnet-4-20250514' as const,
  syntheticModel: 'hf:moonshotai/Kimi-K2.5',
  batchSize: 10,
};
