import bcrypt from 'bcryptjs';
import { getDb } from './index';
import { createUser, getDefaultUser } from './users';
import { createSource, getSourcesByUserId } from './sources';
import { createInterest, getInterestsByUserId } from './interests';

const SEED_INTERESTS = [
  { category: 'AI / LLMs / Local Models', description: 'Artificial intelligence, large language models, running models locally, GPU hardware for inference, tools like Ollama and LM Studio', weight: 1.0 },
  { category: 'Civic Tech / GovTech', description: 'Technology for government, municipal data, public service delivery, open data, civic engagement tools', weight: 1.0 },
  { category: 'Web Development', description: 'JavaScript, TypeScript, React, Next.js, Node.js, CSS, web frameworks, frontend and backend development', weight: 1.0 },
  { category: 'Dallas / DFW Local News', description: 'News and events in Dallas, Fort Worth, and the DFW metroplex area. Local politics, development, community events', weight: 0.8 },
  { category: 'General Tech Industry', description: 'Major tech company news, product launches, industry trends, startup ecosystem', weight: 0.7 },
  { category: 'Gaming / PC Hardware', description: 'PC gaming, GPU news, monitor tech, gaming hardware reviews and deals', weight: 0.6 },
];

const SEED_SOURCES = [
  { name: 'Ars Technica', type: 'rss', config: { url: 'https://feeds.arstechnica.com/arstechnica/index' } },
  { name: 'The Verge', type: 'rss', config: { url: 'https://www.theverge.com/rss/index.xml' } },
  { name: "Simon Willison's Blog", type: 'rss', config: { url: 'https://simonwillison.net/atom/everything/' } },
  { name: 'CSS Tricks', type: 'rss', config: { url: 'https://css-tricks.com/feed/' } },
];

export async function seedDatabase(): Promise<void> {
  await getDb();

  let user = await getDefaultUser();
  if (!user) {
    const hash = bcrypt.hashSync('changeme', 10);
    user = await createUser('admin', hash);
    console.log('Created default user: admin');
  }

  const existingInterests = await getInterestsByUserId(user.id);
  if (existingInterests.length === 0) {
    for (const interest of SEED_INTERESTS) {
      await createInterest(user.id, interest.category, interest.description, interest.weight);
    }
    console.log(`Seeded ${SEED_INTERESTS.length} interests`);
  }

  const existingSources = await getSourcesByUserId(user.id);
  if (existingSources.length === 0) {
    for (const source of SEED_SOURCES) {
      await createSource(user.id, source.name, source.type, source.config);
    }
    console.log(`Seeded ${SEED_SOURCES.length} sources`);
  }
}
