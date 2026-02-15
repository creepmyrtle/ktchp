import { NextResponse } from 'next/server';
import { createSession } from '@/lib/auth';
import { getInviteCodeByCode, redeemInviteCode } from '@/lib/db/invite-codes';
import { createUserWithDefaults, getUserByUsername } from '@/lib/db/users';
import { seedDatabase } from '@/lib/db/seed';

export async function POST(request: Request) {
  try {
    const { code, username, displayName, password, confirmPassword } = await request.json();

    if (!code || !username || !password) {
      return NextResponse.json({ error: 'Invite code, username, and password are required' }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Passwords do not match' }, { status: 400 });
    }

    if (username.length < 3 || username.length > 30) {
      return NextResponse.json({ error: 'Username must be 3-30 characters' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return NextResponse.json({ error: 'Username can only contain letters, numbers, hyphens, and underscores' }, { status: 400 });
    }

    // Ensure DB is seeded
    await seedDatabase();

    // Validate invite code
    const invite = await getInviteCodeByCode(code);
    if (!invite) {
      return NextResponse.json({ error: 'Invalid invite code' }, { status: 400 });
    }
    if (invite.used_by) {
      return NextResponse.json({ error: 'Invite code already used' }, { status: 400 });
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Invite code expired' }, { status: 400 });
    }

    // Check username availability
    const existing = await getUserByUsername(username);
    if (existing) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 400 });
    }

    // Create user
    const user = await createUserWithDefaults(username, password, displayName || null);

    // Redeem invite code
    await redeemInviteCode(code, user.id);

    // Create session
    const token = await createSession(user.id);

    const response = NextResponse.json({ success: true, userId: user.id });
    response.cookies.set('digest_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
