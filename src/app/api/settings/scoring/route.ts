import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { getGlobalSetting, setGlobalSetting } from '@/lib/db/settings';

const SCORING_KEYS = [
  'embedding_llm_threshold',
  'embedding_serendipity_min',
  'embedding_serendipity_max',
  'serendipity_sample_size',
  'max_llm_candidates',
] as const;

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
      if (value !== null) result[key] = value;
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
