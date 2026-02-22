import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getGlobalSetting } from '@/lib/db/settings';
import { sql } from '@vercel/postgres';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get limits from settings (with defaults)
    const [maxInterests, maxExclusions, maxSources] = await Promise.all([
      getGlobalSetting('max_interests_per_user').then(v => v ? parseInt(v, 10) : 20),
      getGlobalSetting('max_exclusions_per_user').then(v => v ? parseInt(v, 10) : 15),
      getGlobalSetting('max_private_sources_per_user').then(v => v ? parseInt(v, 10) : 25),
    ]);

    // Get current counts for this user
    const [interestRes, exclusionRes, sourceRes] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM interests WHERE user_id = ${userId} AND active = TRUE`,
      sql`SELECT COUNT(*) as count FROM exclusions WHERE user_id = ${userId}`,
      sql`SELECT COUNT(*) as count FROM sources WHERE user_id = ${userId} AND is_default = FALSE AND enabled = TRUE`,
    ]);

    return NextResponse.json({
      interests: {
        current: parseInt(interestRes.rows[0].count, 10),
        max: maxInterests,
      },
      exclusions: {
        current: parseInt(exclusionRes.rows[0].count, 10),
        max: maxExclusions,
      },
      private_sources: {
        current: parseInt(sourceRes.rows[0].count, 10),
        max: maxSources,
      },
    });
  } catch (error) {
    console.error('Limits error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
