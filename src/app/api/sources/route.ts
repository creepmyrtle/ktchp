import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { getDefaultUser } from '@/lib/db/users';
import { getSourcesByUserId, createSource } from '@/lib/db/sources';
import { seedDatabase } from '@/lib/db/seed';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await seedDatabase();
    const user = await getDefaultUser();
    if (!user) return NextResponse.json([], { status: 200 });

    const sources = await getSourcesByUserId(user.id);
    return NextResponse.json(sources);
  } catch (error) {
    console.error('Sources error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await seedDatabase();
    const user = await getDefaultUser();
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 500 });

    const { name, type, config } = await request.json();
    if (!name || !type || !config) {
      return NextResponse.json({ error: 'Name, type, and config required' }, { status: 400 });
    }

    const source = await createSource(user.id, name, type, config);
    return NextResponse.json(source, { status: 201 });
  } catch (error) {
    console.error('Create source error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
