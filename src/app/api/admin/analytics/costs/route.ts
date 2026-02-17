import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireAdmin } from '@/lib/auth';
import {
  getCostRates,
  getCostSummary,
  getCostByUser,
  getCostBySource,
  getPipelineEfficiency,
} from '@/lib/db/cost-analytics';
import { setGlobalSetting } from '@/lib/db/settings';

export async function GET(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('window') || '30', 10);

    const rates = await getCostRates();

    const [summary, byUser, bySource, pipeline] = await Promise.all([
      getCostSummary(days, rates),
      getCostByUser(days, rates),
      getCostBySource(days),
      getPipelineEfficiency(days, rates),
    ]);

    return NextResponse.json({
      window_days: days,
      summary,
      by_user: byUser,
      by_source: bySource,
      pipeline,
      rates,
    });
  } catch (error) {
    console.error('Cost analytics error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Update cost rates
export async function PUT(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const body = await request.json();
    const { embedding_per_million, llm_input_per_million, llm_output_per_million } = body;

    if (embedding_per_million !== undefined) {
      await setGlobalSetting('cost_rate_embedding', String(embedding_per_million));
    }
    if (llm_input_per_million !== undefined) {
      await setGlobalSetting('cost_rate_llm_input', String(llm_input_per_million));
    }
    if (llm_output_per_million !== undefined) {
      await setGlobalSetting('cost_rate_llm_output', String(llm_output_per_million));
    }

    const rates = await getCostRates();
    return NextResponse.json(rates);
  } catch (error) {
    console.error('Cost rate update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
