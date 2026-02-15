'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import InterestManager from '@/components/InterestManager';
import SourceManager from '@/components/SourceManager';
import PreferenceViewer from '@/components/PreferenceViewer';
import ScheduleManager from '@/components/ScheduleManager';
import IngestionLogs from '@/components/IngestionLogs';
import SwipeSettings from '@/components/SwipeSettings';
import AdminPanel from '@/components/AdminPanel';
import AccountSettings from '@/components/AccountSettings';

const BASE_TABS = ['Interests', 'Sources', 'Schedule', 'Gestures', 'Preferences', 'Logs', 'Account'] as const;
type Tab = string;

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Interests');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch('/api/account')
      .then(res => res.json())
      .then(data => {
        if (data.is_admin) setIsAdmin(true);
      })
      .catch(() => {});
  }, []);

  const tabs = isAdmin ? [...BASE_TABS, 'Admin'] : [...BASE_TABS];

  return (
    <div className="min-h-screen">
      <nav className="border-b border-card-border px-4 py-3 flex items-center justify-between max-w-5xl mx-auto">
        <Link href="/digest" className="text-lg font-light tracking-tight hover:opacity-80 transition-opacity">ktchp</Link>
        <Link href="/digest" className="text-sm text-accent hover:opacity-80 transition-opacity">
          Back to digest
        </Link>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-light tracking-tight mb-6">Settings</h2>

        <div className="flex flex-wrap gap-1.5 mb-6">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-sm rounded-full transition-colors border ${
                activeTab === tab
                  ? 'bg-accent-light text-accent border-accent'
                  : 'border-card-border text-muted hover:text-foreground hover:border-border-hover'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'Interests' && <InterestManager />}
        {activeTab === 'Sources' && <SourceManager />}
        {activeTab === 'Schedule' && <ScheduleManager />}
        {activeTab === 'Gestures' && <SwipeSettings />}
        {activeTab === 'Preferences' && <PreferenceViewer />}
        {activeTab === 'Logs' && <IngestionLogs />}
        {activeTab === 'Account' && <AccountSettings />}
        {activeTab === 'Admin' && isAdmin && <AdminPanel />}
      </main>
    </div>
  );
}
