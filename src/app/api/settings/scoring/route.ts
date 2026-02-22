import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { getGlobalSetting, setGlobalSetting } from '@/lib/db/settings';

// All scoring keys with their code defaults — single source of truth for the UI.
// The relevance engine has its own matching defaults; these keep the admin panel in sync.
const SCORING_DEFAULTS: Record<string, string> = {
  embedding_llm_threshold: '0.25',
  embedding_serendipity_min: '0.12',
  embedding_serendipity_max: '0.25',
  serendipity_sample_size: '5',
  max_llm_candidates: '40',
  bonus_digest_enabled: 'true',
  bonus_min_score: '0.15',
  bonus_max_articles: '20',
  blended_primary_weight: '0.7',
  blended_secondary_weight: '0.3',
  semantic_dedup_threshold: '0.85',
  exclusion_penalty_threshold: '0.40',
  affinity_analysis_day: '0',
  source_trust_min: '0.8',
  source_trust_max: '1.2',
};

const SCORING_KEYS = Object.keys(SCORING_DEFAULTS);

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin
    const { rows } = await sql`SELECT is_admin FROM users WHERE id = ${userId}`;
    if (!rows[0]?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result: Record<string, string> = {};
    for (const key of SCORING_KEYS) {
      const value = await getGlobalSetting(key);
      result[key] = value ?? SCORING_DEFAULTS[key];
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Get scoring settings error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin
    const { rows } = await sql`SELECT is_admin FROM users WHERE id = ${userId}`;
    if (!rows[0]?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();

    for (const key of SCORING_KEYS) {
      if (body[key] !== undefined) {
        await setGlobalSetting(key, String(body[key]));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update scoring settings error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
