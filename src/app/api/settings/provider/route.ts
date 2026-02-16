import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireAdmin } from '@/lib/auth';
import { getGlobalSetting, setGlobalSetting } from '@/lib/db/settings';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const provider = (await getGlobalSetting('llm_provider')) || 'synthetic';
    return NextResponse.json({ provider });
  } catch (error) {
    console.error('Get provider error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const { provider } = await request.json();
    if (provider !== 'anthropic' && provider !== 'synthetic' && provider !== 'openai') {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    await setGlobalSetting('llm_provider', provider);
    return NextResponse.json({ success: true, provider });
  } catch (error) {
    console.error('Set provider error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
