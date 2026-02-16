import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import OpenAI from 'openai';

async function main() {
  const client = new OpenAI({
    apiKey: process.env.SYNTHETIC_API_KEY,
    baseURL: 'https://api.synthetic.new/openai/v1',
  });

  console.log('Sending simple test request...');

  const response = await client.chat.completions.create({
    model: 'hf:moonshotai/Kimi-K2.5',
    max_tokens: 256,
    messages: [{ role: 'user', content: 'Say hello in JSON: {"greeting": "..."}' }],
  });

  console.log('Status/finish_reason:', response.choices[0]?.finish_reason);
  console.log('Content:', JSON.stringify(response.choices[0]?.message?.content));
  console.log('Full response:', JSON.stringify(response, null, 2));
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
