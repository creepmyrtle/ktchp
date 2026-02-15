import { NextResponse } from 'next/server';
import { authenticateUser, createSession } from '@/lib/auth';
import { seedDatabase } from '@/lib/db/seed';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
    }

    // Ensure DB is seeded
    await seedDatabase();

    const userId = await authenticateUser(username, password);
    if (!userId) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const token = await createSession(userId);

    const response = NextResponse.json({ success: true, userId });
    response.cookies.set('digest_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
