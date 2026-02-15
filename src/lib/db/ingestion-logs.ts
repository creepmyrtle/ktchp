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

export async function getAllIngestionLogs(
  limit: number = 20
): Promise<Omit<IngestionLog, 'events'>[]> {
  const { rows } = await sql`
    SELECT il.id, il.user_id, il.provider, il.trigger, il.status, il.started_at,
           il.finished_at, il.duration_ms, il.summary, il.error,
           u.username, u.display_name
    FROM ingestion_logs il
    LEFT JOIN users u ON u.id = il.user_id
    ORDER BY il.started_at DESC
    LIMIT ${limit}
  `;
  return rows as Omit<IngestionLog, 'events'>[];
}

export async function markStaleLogsAsTimedOut(): Promise<number> {
  const { rowCount } = await sql`
    UPDATE ingestion_logs
    SET status = 'error', finished_at = NOW(), error = 'Timed out (stale running state)'
    WHERE status = 'running' AND finished_at IS NULL
  `;
  return rowCount ?? 0;
}

export async function getIngestionLogById(id: string): Promise<IngestionLog | null> {
  const { rows } = await sql`
    SELECT * FROM ingestion_logs WHERE id = ${id}
  `;
  return (rows[0] as IngestionLog) ?? null;
}
