import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getSourceTrustForUser } from '@/lib/db/source-trust';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const trustData = await getSourceTrustForUser(userId);
    return NextResponse.json(trustData);
  } catch (error) {
    console.error('Source trust error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
