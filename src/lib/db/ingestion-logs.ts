import { sql } from '@vercel/postgres';
import type { IngestionLog, LogEvent } from '@/types';

export async function createIngestionLog(
  userId: string,
  provider: string,
  trigger: 'cron' | 'manual'
): Promise<string> {
  const { rows } = await sql`
    INSERT INTO ingestion_logs (user_id, provider, trigger)
    VALUES (${userId}, ${provider}, ${trigger})
    RETURNING id
  `;
  return rows[0].id as string;
}

export async function completeIngestionLog(
  id: string,
  status: 'success' | 'error',
  durationMs: number,
  summary: Record<string, unknown>,
  events: LogEvent[],
  error?: string
): Promise<void> {
  const summaryJson = JSON.stringify(summary);
  const eventsJson = JSON.stringify(events);
  await sql`
    UPDATE ingestion_logs
    SET status = ${status},
        finished_at = NOW(),
        duration_ms = ${durationMs},
        summary = ${summaryJson}::jsonb,
        events = ${eventsJson}::jsonb,
        error = ${error ?? null}
    WHERE id = ${id}
  `;
}

export async function getIngestionLogs(
  userId: string,
  limit: number = 20
): Promise<Omit<IngestionLog, 'events'>[]> {
  const { rows } = await sql`
    SELECT id, user_id, provider, trigger, status, started_at, finished_at,
           duration_ms, summary, error
    FROM ingestion_logs
    WHERE user_id = ${userId}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;
  return rows as Omit<IngestionLog, 'events'>[];
}

export async function getIngestionLogById(id: string): Promise<IngestionLog | null> {
  const { rows } = await sql`
    SELECT * FROM ingestion_logs WHERE id = ${id}
  `;
  return (rows[0] as IngestionLog) ?? null;
}
