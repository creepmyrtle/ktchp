import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getDefaultUser } from '@/lib/db/users';
import { getSetting, setSetting } from '@/lib/db/settings';
import { seedDatabase } from '@/lib/db/seed';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await seedDatabase();
    const user = await getDefaultUser();
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 500 });

    const provider = (await getSetting(user.id, 'llm_provider')) || 'anthropic';
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

    await seedDatabase();
    const user = await getDefaultUser();
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 500 });

    const { provider } = await request.json();
    if (provider !== 'anthropic' && provider !== 'synthetic') {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    await setSetting(user.id, 'llm_provider', provider);
    return NextResponse.json({ success: true, provider });
  } catch (error) {
    console.error('Set provider error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
