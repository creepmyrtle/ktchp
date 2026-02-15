import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from './config';
import { getGlobalSetting } from './db/settings';
import { getDb } from './db/index';

export type LlmProvider = 'anthropic' | 'synthetic';

export async function getActiveProvider(): Promise<LlmProvider> {
  try {
    await getDb();
    const saved = await getGlobalSetting('llm_provider');
    if (saved === 'anthropic' || saved === 'synthetic') return saved;
  } catch {
    // DB not ready yet — fall back to default
  }
  return 'synthetic';
}

interface LlmResponse {
  text: string;
}

let anthropicClient: Anthropic | null = null;
let syntheticClient: OpenAI | null = null;

function getAnthropicClient(): Anthropic | null {
  if (!config.anthropicApiKey || config.anthropicApiKey === 'sk-ant-your-key-here') {
    return null;
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return anthropicClient;
}

function getSyntheticClient(): OpenAI | null {
  if (!config.syntheticApiKey) {
    return null;
  }
  if (!syntheticClient) {
    syntheticClient = new OpenAI({
      apiKey: config.syntheticApiKey,
      baseURL: 'https://api.synthetic.new/openai/v1',
    });
  }
  return syntheticClient;
}

export async function llmComplete(prompt: string, maxTokens: number = 4096): Promise<LlmResponse | null> {
  const provider = await getActiveProvider();

  if (provider === 'synthetic') {
    const client = getSyntheticClient();
    if (!client) return null;

    const response = await client.chat.completions.create({
      model: config.syntheticModel,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0]?.message?.content || '';
    return { text };
  }

  // Default: Anthropic
  const client = getAnthropicClient();
  if (!client) return null;

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return { text };
}
