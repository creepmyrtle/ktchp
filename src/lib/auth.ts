import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getUserById, getUserByUsername } from './db/users';
import { sql } from '@vercel/postgres';
import { getDb } from './db/index';

const SESSION_COOKIE = 'digest_session';
const SESSION_SECRET = process.env.CRON_SECRET || 'default-secret';

export async function authenticateUser(username: string, password: string): Promise<string | null> {
  await getDb();
  const user = await getUserByUsername(username);
  if (!user || !user.is_active) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  return user.id;
}

export async function createSession(userId: string): Promise<string> {
  await getDb();
  const token = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(crypto.randomBytes(32))
    .digest('hex');

  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

  await sql`
    INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userId}, ${expiresAt})
    ON CONFLICT (token) DO UPDATE SET user_id = ${userId}, expires_at = ${expiresAt}
  `;

  return token;
}

export async function validateSession(token: string): Promise<string | null> {
  await getDb();
  const { rows } = await sql`SELECT user_id, expires_at FROM sessions WHERE token = ${token}`;
  const row = rows[0] as { user_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (Date.now() > parseInt(row.expires_at, 10)) {
    await sql`DELETE FROM sessions WHERE token = ${token}`;
    return null;
  }
  return row.user_id;
}

export async function destroySession(token: string): Promise<void> {
  await getDb();
  await sql`DELETE FROM sessions WHERE token = ${token}`;
}

export async function getSessionFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await destroySession(token);
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function requireAuth(): Promise<string> {
  const userId = await getSessionFromCookies();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  return userId;
}

// For cron triggers: returns 'all_users' marker. For session auth: returns null (caller should use getSessionFromCookies).
export async function requireCronOrAuth(request: Request): Promise<'all_users' | null> {
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return 'all_users';
  }
  return null;
}

export async function requireAdmin(userId: string): Promise<boolean> {
  const user = await getUserById(userId);
  return user?.is_admin === true;
}
