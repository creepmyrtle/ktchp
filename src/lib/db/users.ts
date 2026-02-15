import { sql } from '@vercel/postgres';
import type { User } from '@/types';

export async function createUser(username: string, passwordHash: string): Promise<User> {
  await sql`
    INSERT INTO users (username, password_hash)
    VALUES (${username}, ${passwordHash})
  `;
  return (await getUserByUsername(username))!;
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
