import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireAdmin } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { getDb } from '@/lib/db/index';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await getDb();

    const { rows } = await sql`
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.is_admin,
        u.is_active,
        u.created_at,
        (SELECT MAX(f.created_at) FROM feedback f WHERE f.user_id = u.id) as last_active,
        (SELECT COUNT(*) FROM interests i WHERE i.user_id = u.id AND i.active = TRUE) as interest_count,
        (SELECT COUNT(*) FROM exclusions e WHERE e.user_id = u.id) as exclusion_count,
        (SELECT COUNT(*) FROM sources s WHERE s.user_id = u.id AND s.is_default = FALSE AND s.enabled = TRUE) as private_source_count
      FROM users u
      ORDER BY u.created_at ASC
    `;

    // Get 30-day LLM costs per user
    const { rows: costRows } = await sql`
      SELECT
        kv.key as user_id,
        COALESCE(SUM((kv.value->>'llmInputTokens')::int), 0) as llm_input_tokens,
        COALESCE(SUM((kv.value->>'llmOutputTokens')::int), 0) as llm_output_tokens
      FROM ingestion_logs il,
        LATERAL jsonb_each(COALESCE(il.summary->'userResults', '{}'::jsonb)) AS kv(key, value)
      WHERE il.status = 'success'
        AND il.started_at > NOW() - INTERVAL '30 days'
      GROUP BY kv.key
    `;

    const costMap = new Map(costRows.map(c => [c.user_id, {
      llm_input_tokens: parseInt(c.llm_input_tokens, 10),
      llm_output_tokens: parseInt(c.llm_output_tokens, 10),
    }]));

    const users = rows.map(u => {
      const costs = costMap.get(u.id);
      // Simple cost estimate using default rates
      const llmCost = costs
        ? ((costs.llm_input_tokens / 1_000_000) * 0.15 + (costs.llm_output_tokens / 1_000_000) * 0.60)
        : 0;

      return {
        id: u.id,
        username: u.username,
        display_name: u.display_name || u.username,
        is_admin: u.is_admin,
        is_active: u.is_active,
        created_at: u.created_at,
        last_active: u.last_active,
        interest_count: parseInt(u.interest_count, 10),
        exclusion_count: parseInt(u.exclusion_count, 10),
        private_source_count: parseInt(u.private_source_count, 10),
        llm_cost_30d: parseFloat(llmCost.toFixed(4)),
      };
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error('Users overview error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
