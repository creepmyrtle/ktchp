import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireAdmin } from '@/lib/auth';
import { getGlobalSetting, setGlobalSetting } from '@/lib/db/settings';

const LIMIT_KEYS = {
  max_interests_per_user: '20',
  max_exclusions_per_user: '15',
  max_private_sources_per_user: '25',
} as const;

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

    const limits: Record<string, number> = {};
    for (const [key, defaultVal] of Object.entries(LIMIT_KEYS)) {
      const val = await getGlobalSetting(key);
      limits[key] = val ? parseInt(val, 10) : parseInt(defaultVal, 10);
    }

    return NextResponse.json(limits);
  } catch (error) {
    console.error('Limits GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();

    for (const key of Object.keys(LIMIT_KEYS)) {
      if (body[key] !== undefined) {
        const val = parseInt(body[key], 10);
        if (isNaN(val) || val < 1) {
          return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 });
        }
        await setGlobalSetting(key, String(val));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Limits PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
