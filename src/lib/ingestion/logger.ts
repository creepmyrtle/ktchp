import type { LogEvent } from '@/types';
import { createIngestionLog, completeIngestionLog } from '../db/ingestion-logs';

export class IngestionLogger {
  private events: LogEvent[] = [];
  private startTime: number;
  private logId: string | null = null;

  constructor(
    private userId: string,
    private provider: string,
    private trigger: 'cron' | 'manual'
  ) {
    this.startTime = Date.now();
  }

  async init(): Promise<void> {
    this.logId = await createIngestionLog(this.userId, this.provider, this.trigger);
  }

  log(phase: string, message: string, data?: Record<string, unknown>) {
    this.addEvent('info', phase, message, data);
  }

  warn(phase: string, message: string, data?: Record<string, unknown>) {
    this.addEvent('warn', phase, message, data);
  }

  error(phase: string, message: string, data?: Record<string, unknown>) {
    this.addEvent('error', phase, message, data);
  }

  private addEvent(level: LogEvent['level'], phase: string, message: string, data?: Record<string, unknown>) {
    this.events.push({
      timestamp: new Date().toISOString(),
      phase,
      level,
      message,
      ...(data ? { data } : {}),
    });
  }

  async persist(status: 'success' | 'error', summary: Record<string, unknown>, error?: string) {
    if (!this.logId) return;
    const durationMs = Date.now() - this.startTime;
    await completeIngestionLog(this.logId, status, durationMs, summary, this.events, error);
  }
}
