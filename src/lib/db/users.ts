import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';
import type { User } from '@/types';
import { createInterest } from './interests';

export const DEFAULT_INTERESTS = [
  { category: 'Web Development', description: 'JavaScript, TypeScript, React, Next.js, Node.js, CSS, web frameworks, frontend and backend development', weight: 1.0 },
  { category: 'AI / Machine Learning', description: 'Artificial intelligence, machine learning, large language models, AI tools and applications', weight: 1.0 },
  { category: 'General Tech Industry', description: 'Major tech company news, product launches, industry trends, startup ecosystem', weight: 0.8 },
  { category: 'Science & Research', description: 'Scientific discoveries, research breakthroughs, space, physics, biology', weight: 0.7 },
  { category: 'Business & Finance', description: 'Business strategy, economics, market trends, entrepreneurship', weight: 0.6 },
  { category: 'World News', description: 'Major world events, international affairs, policy changes', weight: 0.5 },
];

export async function createUser(username: string, passwordHash: string): Promise<User> {
  await sql`
    INSERT INTO users (username, password_hash)
    VALUES (${username}, ${passwordHash})
  `;
  return (await getUserByUsername(username))!;
}

export async function createUserWithDefaults(
  username: string,
  password: string,
  displayName: string | null = null
): Promise<User> {
  const hash = bcrypt.hashSync(password, 10);
  const { rows } = await sql`
    INSERT INTO users (username, password_hash, display_name, is_admin, is_active)
    VALUES (${username}, ${hash}, ${displayName || username}, FALSE, TRUE)
    RETURNING *
  `;
  const user = rows[0] as User;

  // Seed generic interests
  for (const interest of DEFAULT_INTERESTS) {
    await createInterest(user.id, interest.category, interest.description, interest.weight);
  }

  return user;
}

export async function getUserById(id: string): Promise<User | null> {
  const { rows } = await sql`SELECT * FROM users WHERE id = ${id}`;
  return (rows[0] as User) ?? null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const { rows } = await sql`SELECT * FROM users WHERE username = ${username}`;
  return (rows[0] as User) ?? null;
}

export async function getDefaultUser(): Promise<User | null> {
  const { rows } = await sql`SELECT * FROM users ORDER BY created_at ASC LIMIT 1`;
  return (rows[0] as User) ?? null;
}

export async function getAllActiveUsers(): Promise<User[]> {
  const { rows } = await sql`SELECT * FROM users WHERE is_active = TRUE ORDER BY created_at ASC`;
  return rows as User[];
}

export async function getAllUsers(): Promise<User[]> {
  const { rows } = await sql`SELECT * FROM users ORDER BY created_at ASC`;
  return rows as User[];
}

export async function updateUser(
  id: string,
  updates: Partial<Pick<User, 'display_name' | 'is_active' | 'is_admin' | 'password_hash'>>
): Promise<User | null> {
  if (updates.display_name !== undefined) {
    await sql`UPDATE users SET display_name = ${updates.display_name} WHERE id = ${id}`;
  }
  if (updates.is_active !== undefined) {
    await sql`UPDATE users SET is_active = ${updates.is_active} WHERE id = ${id}`;
  }
  if (updates.is_admin !== undefined) {
    await sql`UPDATE users SET is_admin = ${updates.is_admin} WHERE id = ${id}`;
  }
  if (updates.password_hash !== undefined) {
    await sql`UPDATE users SET password_hash = ${updates.password_hash} WHERE id = ${id}`;
  }
  return getUserById(id);
}

export async function deleteUser(id: string): Promise<boolean> {
  // Delete all user data in dependency order
  await sql`DELETE FROM feedback WHERE user_id = ${id}`;
  await sql`DELETE FROM user_articles WHERE user_id = ${id}`;
  await sql`DELETE FROM digests WHERE user_id = ${id}`;
  await sql`DELETE FROM user_source_settings WHERE user_id = ${id}`;
  await sql`DELETE FROM source_trust WHERE user_id = ${id}`;
  await sql`DELETE FROM sources WHERE user_id = ${id}`;
  await sql`DELETE FROM interests WHERE user_id = ${id}`;
  await sql`DELETE FROM exclusions WHERE user_id = ${id}`;
  await sql`DELETE FROM interest_suggestions WHERE user_id = ${id}`;
  await sql`DELETE FROM learned_preferences WHERE user_id = ${id}`;
  await sql`DELETE FROM settings WHERE user_id = ${id}`;
  await sql`DELETE FROM sessions WHERE user_id = ${id}`;
  await sql`DELETE FROM ingestion_logs WHERE user_id = ${id}`;
  // Clear invite code references (don't delete codes themselves)
  await sql`UPDATE invite_codes SET used_by = NULL, used_at = NULL WHERE used_by = ${id}`;
  await sql`DELETE FROM invite_codes WHERE created_by = ${id} AND used_by IS NULL`;
  // Delete the user
  const { rowCount } = await sql`DELETE FROM users WHERE id = ${id}`;
  return (rowCount ?? 0) > 0;
}
