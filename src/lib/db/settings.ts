import { sql } from '@vercel/postgres';

export async function getSetting(userId: string, key: string): Promise<string | null> {
  const { rows } = await sql`
    SELECT value FROM settings WHERE user_id = ${userId} AND key = ${key}
  `;
  return rows[0]?.value ?? null;
}

export async function setSetting(userId: string, key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO settings (user_id, key, value) VALUES (${userId}, ${key}, ${value})
    ON CONFLICT (user_id, key) DO UPDATE SET value = ${value}
  `;
}

export async function getGlobalSetting(key: string): Promise<string | null> {
  return getSetting('global', key);
}

export async function setGlobalSetting(key: string, value: string): Promise<void> {
  return setSetting('global', key, value);
}

export async function getSchedule(userId: string): Promise<string[]> {
  const raw = await getSetting(userId, 'digest_times');
  if (!raw) return ['07:00', '17:00'];
  try {
    return JSON.parse(raw);
  } catch {
    return ['07:00', '17:00'];
  }
}

export async function setSchedule(userId: string, times: string[]): Promise<void> {
  await setSetting(userId, 'digest_times', JSON.stringify(times));
}
