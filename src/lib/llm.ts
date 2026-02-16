import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from './config';
import { getGlobalSetting } from './db/settings';
import { getDb } from './db/index';

export type LlmProvider = 'anthropic' | 'synthetic' | 'openai';

export async function getActiveProvider(): Promise<LlmProvider> {
  try {
    await getDb();
    const saved = await getGlobalSetting('llm_provider');
    if (saved === 'anthropic' || saved === 'synthetic' || saved === 'openai') return saved;
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
let openaiClient: OpenAI | null = null;

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

function getOpenaiClient(): OpenAI | null {
  if (!config.openaiApiKey) {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.openaiApiKey,
    });
  }
  return openaiClient;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 10000]; // ms

function isRetryable(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status;
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 524;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function llmComplete(prompt: string, maxTokens: number = 4096): Promise<LlmResponse | null> {
  const provider = await getActiveProvider();

  if (provider === 'synthetic') {
    const client = getSyntheticClient();
    if (!client) return null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.chat.completions.create({
          model: config.syntheticModel,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: 'You are a helpful assistant. Always respond with valid JSON when asked. No markdown fences, no explanations — just the JSON.' },
            { role: 'user', content: prompt },
          ],
        });

        const text = response.choices[0]?.message?.content?.trim() || '';
        if (!text) {
          console.warn('[llm] Synthetic returned empty. finish_reason:', response.choices[0]?.finish_reason, 'usage:', JSON.stringify(response.usage));
        }
        return { text };
      } catch (err) {
        if (isRetryable(err) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt] || 10000;
          console.warn(`[llm] Synthetic API error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`);
          await sleep(delay);
          continue;
        }
        console.error('[llm] Synthetic API error (no more retries):', err);
        return null;
      }
    }
    return null;
  }

  if (provider === 'openai') {
    const client = getOpenaiClient();
    if (!client) return null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.chat.completions.create({
          model: config.openaiModel,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: 'You are a helpful assistant. Always respond with valid JSON when asked. No markdown fences, no explanations — just the JSON.' },
            { role: 'user', content: prompt },
          ],
        });

        const text = response.choices[0]?.message?.content?.trim() || '';
        if (!text) {
          console.warn('[llm] OpenAI returned empty. finish_reason:', response.choices[0]?.finish_reason, 'usage:', JSON.stringify(response.usage));
        }
        return { text };
      } catch (err) {
        if (isRetryable(err) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt] || 10000;
          console.warn(`[llm] OpenAI API error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`);
          await sleep(delay);
          continue;
        }
        console.error('[llm] OpenAI API error (no more retries):', err);
        return null;
      }
    }
    return null;
  }

  // Default: Anthropic
  const client = getAnthropicClient();
  if (!client) return null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
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
    } catch (err) {
      if (isRetryable(err) && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] || 10000;
        console.warn(`[llm] Anthropic API error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      console.error('[llm] Anthropic API error (no more retries):', err);
      return null;
    }
  }
  return null;
}
