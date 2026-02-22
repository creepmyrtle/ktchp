import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getUserById, getUserByUsername } from './db/users';
import { sql } from '@vercel/postgres';
import { getDb } from './db/index';
import { config } from './config';

const SESSION_COOKIE = 'digest_session';
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSION_REFRESH_THRESHOLD_MS = 3.5 * 24 * 60 * 60 * 1000; // 3.5 days

let sessionSecretWarned = false;

function getSessionSecret(): string {
  const secret = config.sessionSecret;
  if (!process.env.SESSION_SECRET && !sessionSecretWarned) {
    sessionSecretWarned = true;
    console.warn('SESSION_SECRET not set — falling back to CRON_SECRET. Set SESSION_SECRET for production.');
  }
  return secret;
}

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
    .createHmac('sha256', getSessionSecret())
    .update(crypto.randomBytes(32))
    .digest('hex');

  const now = Date.now();
  const expiresAt = now + SESSION_LIFETIME_MS;

  await sql`
    INSERT INTO sessions (token, user_id, expires_at, refreshed_at) VALUES (${token}, ${userId}, ${expiresAt}, ${now})
    ON CONFLICT (token) DO UPDATE SET user_id = ${userId}, expires_at = ${expiresAt}, refreshed_at = ${now}
  `;

  return token;
}

interface ValidateResult {
  userId: string;
  newToken?: string;
}

export async function validateSession(token: string): Promise<ValidateResult | null> {
  await getDb();
  const { rows } = await sql`SELECT user_id, expires_at, refreshed_at FROM sessions WHERE token = ${token}`;
  const row = rows[0] as { user_id: string; expires_at: string; refreshed_at?: string } | undefined;
  if (!row) return null;

  const expiresAt = parseInt(row.expires_at, 10);
  if (Date.now() > expiresAt) {
    await sql`DELETE FROM sessions WHERE token = ${token}`;
    return null;
  }

  // Compute session age: use refreshed_at if available, otherwise derive from expires_at
  const refreshedAt = row.refreshed_at
    ? parseInt(row.refreshed_at, 10)
    : expiresAt - SESSION_LIFETIME_MS;
  const sessionAge = Date.now() - refreshedAt;

  // If session is older than threshold, rotate the token
  if (sessionAge > SESSION_REFRESH_THRESHOLD_MS) {
    const newToken = crypto
      .createHmac('sha256', getSessionSecret())
      .update(crypto.randomBytes(32))
      .digest('hex');

    const now = Date.now();
    const newExpiresAt = now + SESSION_LIFETIME_MS;

    // Insert new session, then delete old one
    await sql`INSERT INTO sessions (token, user_id, expires_at, refreshed_at) VALUES (${newToken}, ${row.user_id}, ${newExpiresAt}, ${now})`;
    await sql`DELETE FROM sessions WHERE token = ${token}`;

    return { userId: row.user_id, newToken };
  }

  return { userId: row.user_id };
}

export async function destroySession(token: string): Promise<void> {
  await getDb();
  await sql`DELETE FROM sessions WHERE token = ${token}`;
}

export async function getSessionFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const result = await validateSession(token);
  if (!result) return null;

  // If session was refreshed, update the cookie
  if (result.newToken) {
    cookieStore.set(SESSION_COOKIE, result.newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });
  }

  return result.userId;
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
