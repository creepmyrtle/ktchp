import { NextResponse } from 'next/server';
import { getSessionFromCookies, requireAdmin } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { getDb } from '@/lib/db/index';

export async function GET() {
  try {
    const userId = await getSessionFromCookies();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const isAdmin = await requireAdmin(userId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await getDb();

    // Total database size
    const { rows: dbSize } = await sql`SELECT pg_database_size(current_database()) as total_bytes`;
    const totalBytes = parseInt(dbSize[0].total_bytes, 10);

    // Per-table stats
    const { rows: tableStats } = await sql`
      SELECT
        schemaname,
        relname as table_name,
        n_live_tup as row_count,
        pg_total_relation_size(schemaname || '.' || relname) as size_bytes
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(schemaname || '.' || relname) DESC
    `;

    const tables = tableStats.map(t => ({
      name: t.table_name,
      rows: parseInt(t.row_count, 10),
      size_bytes: parseInt(t.size_bytes, 10),
      size_mb: parseFloat((parseInt(t.size_bytes, 10) / (1024 * 1024)).toFixed(2)),
    }));

    const totalMb = parseFloat((totalBytes / (1024 * 1024)).toFixed(2));
    const limitMb = 256;

    return NextResponse.json({
      total_bytes: totalBytes,
      total_mb: totalMb,
      limit_mb: limitMb,
      usage_percent: parseFloat(((totalMb / limitMb) * 100).toFixed(1)),
      session_secret_configured: !!process.env.SESSION_SECRET,
      tables,
    });
  } catch (error) {
    console.error('Storage stats error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
