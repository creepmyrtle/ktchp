'use client';

import { useState, useEffect } from 'react';

interface StorageData {
  total_mb: number;
  limit_mb: number;
  usage_percent: number;
  session_secret_configured: boolean;
  tables: Array<{ name: string; rows: number; size_bytes: number; size_mb: number }>;
}

interface UserOverview {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  last_active: string | null;
  interest_count: number;
  exclusion_count: number;
  private_source_count: number;
  llm_cost_30d: number;
}

interface Limits {
  max_interests_per_user: number;
  max_exclusions_per_user: number;
  max_private_sources_per_user: number;
}

type SortKey = 'username' | 'interest_count' | 'exclusion_count' | 'private_source_count' | 'llm_cost_30d';

function usd(n: number): string {
  if (n < 0.01 && n > 0) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function SystemHealth() {
  const [storage, setStorage] = useState<StorageData | null>(null);
  const [users, setUsers] = useState<UserOverview[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('username');
  const [sortAsc, setSortAsc] = useState(true);

  // Limit editing state
  const [editingLimits, setEditingLimits] = useState(false);
  const [editMaxInterests, setEditMaxInterests] = useState('');
  const [editMaxExclusions, setEditMaxExclusions] = useState('');
  const [editMaxSources, setEditMaxSources] = useState('');
  const [savingLimits, setSavingLimits] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/storage').then(r => r.ok ? r.json() : null),
      fetch('/api/admin/users/overview').then(r => r.ok ? r.json() : null),
      fetch('/api/admin/limits').then(r => r.ok ? r.json() : null),
    ]).then(([storageData, usersData, limitsData]) => {
      if (storageData) setStorage(storageData);
      if (usersData) setUsers(usersData);
      if (limitsData) {
        setLimits(limitsData);
        setEditMaxInterests(String(limitsData.max_interests_per_user));
        setEditMaxExclusions(String(limitsData.max_exclusions_per_user));
        setEditMaxSources(String(limitsData.max_private_sources_per_user));
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'username');
    }
  }

  const sortedUsers = [...users].sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    if (sortKey === 'username') return a.username.localeCompare(b.username) * dir;
    return ((a[sortKey] as number) - (b[sortKey] as number)) * dir;
  });

  async function saveLimits() {
    setSavingLimits(true);
    try {
      await fetch('/api/admin/limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          max_interests_per_user: parseInt(editMaxInterests, 10),
          max_exclusions_per_user: parseInt(editMaxExclusions, 10),
          max_private_sources_per_user: parseInt(editMaxSources, 10),
        }),
      });
      setLimits({
        max_interests_per_user: parseInt(editMaxInterests, 10),
        max_exclusions_per_user: parseInt(editMaxExclusions, 10),
        max_private_sources_per_user: parseInt(editMaxSources, 10),
      });
      setEditingLimits(false);
    } catch {
      // ignore
    }
    setSavingLimits(false);
  }

  if (loading) return <p className="text-sm text-muted">Loading system health...</p>;

  // Compute alerts
  const alerts: string[] = [];
  if (storage && storage.usage_percent > 75) {
    alerts.push(`Database storage is at ${storage.usage_percent}% (${storage.total_mb.toFixed(1)} / ${storage.limit_mb} MB).`);
  }
  if (storage && !storage.session_secret_configured) {
    alerts.push('SESSION_SECRET is not configured. Sessions are using CRON_SECRET as fallback.');
  }
  if (limits) {
    for (const u of users) {
      if (u.interest_count >= limits.max_interests_per_user - 2) {
        alerts.push(`${u.display_name} is near the interest limit (${u.interest_count}/${limits.max_interests_per_user}).`);
      }
      if (u.private_source_count >= limits.max_private_sources_per_user - 2) {
        alerts.push(`${u.display_name} is near the source limit (${u.private_source_count}/${limits.max_private_sources_per_user}).`);
      }
    }
  }

  function progressColor(pct: number): string {
    if (pct < 50) return 'bg-green-500';
    if (pct < 75) return 'bg-yellow-500';
    if (pct < 90) return 'bg-orange-500';
    return 'bg-red-500';
  }

  function isNearLimit(current: number, max: number): boolean {
    return current >= max - 2;
  }

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortAsc ? ' \u2191' : ' \u2193';
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-light tracking-tight">System Health</h3>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-1">
          {alerts.map((alert, i) => (
            <p key={i} className="text-xs text-yellow-400">{alert}</p>
          ))}
        </div>
      )}

      {/* Database Storage */}
      {storage && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">Database Storage</h4>
          <div className="mb-2">
            <div className="flex justify-between text-xs text-muted mb-1">
              <span>{storage.total_mb.toFixed(1)} MB used</span>
              <span>{storage.limit_mb} MB limit</span>
            </div>
            <div className="w-full h-2 bg-card-border rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${progressColor(storage.usage_percent)}`}
                style={{ width: `${Math.min(storage.usage_percent, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted mt-1">{storage.usage_percent}% used</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b border-card-border">
                  <th className="text-left py-1.5 pr-2 font-normal">Table</th>
                  <th className="text-right py-1.5 px-2 font-normal">Rows</th>
                  <th className="text-right py-1.5 pl-2 font-normal">Size</th>
                </tr>
              </thead>
              <tbody>
                {storage.tables.map(t => (
                  <tr key={t.name} className="border-b border-card-border/50">
                    <td className="py-1.5 pr-2 text-foreground">{t.name}</td>
                    <td className="text-right py-1.5 px-2 text-muted">{t.rows.toLocaleString()}</td>
                    <td className="text-right py-1.5 pl-2 text-foreground">{t.size_mb.toFixed(2)} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* User Overview */}
      {users.length > 0 && limits && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">User Overview</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b border-card-border">
                  <th
                    className="text-left py-1.5 pr-2 font-normal cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('username')}
                  >
                    User{sortIndicator('username')}
                  </th>
                  <th className="text-center py-1.5 px-2 font-normal">Role</th>
                  <th className="text-center py-1.5 px-2 font-normal">Status</th>
                  <th
                    className="text-right py-1.5 px-2 font-normal cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('interest_count')}
                  >
                    Interests{sortIndicator('interest_count')}
                  </th>
                  <th
                    className="text-right py-1.5 px-2 font-normal cursor-pointer hover:text-foreground hidden sm:table-cell"
                    onClick={() => handleSort('exclusion_count')}
                  >
                    Exclusions{sortIndicator('exclusion_count')}
                  </th>
                  <th
                    className="text-right py-1.5 px-2 font-normal cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('private_source_count')}
                  >
                    Sources{sortIndicator('private_source_count')}
                  </th>
                  <th
                    className="text-right py-1.5 pl-2 font-normal cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('llm_cost_30d')}
                  >
                    Cost (30d){sortIndicator('llm_cost_30d')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map(u => (
                  <tr key={u.id} className="border-b border-card-border/50">
                    <td className="py-1.5 pr-2 text-foreground">
                      <div>
                        <span>{u.display_name}</span>
                        {u.last_active && (
                          <span className="text-muted ml-1 text-[10px]">({timeAgo(u.last_active)})</span>
                        )}
                      </div>
                    </td>
                    <td className="text-center py-1.5 px-2 text-muted">
                      {u.is_admin ? 'Admin' : 'User'}
                    </td>
                    <td className="text-center py-1.5 px-2">
                      <span className={u.is_active ? 'text-green-400' : 'text-red-400'}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className={`text-right py-1.5 px-2 ${isNearLimit(u.interest_count, limits.max_interests_per_user) ? 'text-yellow-400' : 'text-muted'}`}>
                      {u.interest_count}/{limits.max_interests_per_user}
                    </td>
                    <td className={`text-right py-1.5 px-2 hidden sm:table-cell ${isNearLimit(u.exclusion_count, limits.max_exclusions_per_user) ? 'text-yellow-400' : 'text-muted'}`}>
                      {u.exclusion_count}/{limits.max_exclusions_per_user}
                    </td>
                    <td className={`text-right py-1.5 px-2 ${isNearLimit(u.private_source_count, limits.max_private_sources_per_user) ? 'text-yellow-400' : 'text-muted'}`}>
                      {u.private_source_count}/{limits.max_private_sources_per_user}
                    </td>
                    <td className="text-right py-1.5 pl-2 text-foreground">{usd(u.llm_cost_30d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Resource Limits */}
      {limits && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-foreground">Resource Limits</h4>
            {!editingLimits && (
              <button
                onClick={() => setEditingLimits(true)}
                className="text-xs text-accent hover:opacity-80"
              >
                Edit
              </button>
            )}
          </div>

          {editingLimits ? (
            <div className="space-y-2 rounded-lg border border-card-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs text-muted">Max interests per user</label>
                <input
                  type="number"
                  min="1"
                  value={editMaxInterests}
                  onChange={e => setEditMaxInterests(e.target.value)}
                  className="w-16 px-2 py-1 text-xs rounded border border-card-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs text-muted">Max exclusions per user</label>
                <input
                  type="number"
                  min="1"
                  value={editMaxExclusions}
                  onChange={e => setEditMaxExclusions(e.target.value)}
                  className="w-16 px-2 py-1 text-xs rounded border border-card-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs text-muted">Max private sources per user</label>
                <input
                  type="number"
                  min="1"
                  value={editMaxSources}
                  onChange={e => setEditMaxSources(e.target.value)}
                  className="w-16 px-2 py-1 text-xs rounded border border-card-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="flex justify-end gap-2 mt-1">
                <button
                  onClick={() => setEditingLimits(false)}
                  className="text-xs px-3 py-1 rounded border border-card-border text-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={saveLimits}
                  disabled={savingLimits}
                  className="text-xs px-3 py-1 rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
                >
                  {savingLimits ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">Max interests per user</span>
                <span className="text-foreground">{limits.max_interests_per_user}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Max exclusions per user</span>
                <span className="text-foreground">{limits.max_exclusions_per_user}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Max private sources per user</span>
                <span className="text-foreground">{limits.max_private_sources_per_user}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
