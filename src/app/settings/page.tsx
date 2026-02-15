'use client';

import { useState } from 'react';
import Link from 'next/link';
import InterestManager from '@/components/InterestManager';
import SourceManager from '@/components/SourceManager';
import ManualUrlInput from '@/components/ManualUrlInput';
import PreferenceViewer from '@/components/PreferenceViewer';
import ScheduleManager from '@/components/ScheduleManager';

const TABS = ['Interests', 'Sources', 'Schedule', 'Manual URL', 'Preferences'] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Interests');

  return (
    <div className="min-h-screen">
      <nav className="border-b border-card-border px-4 py-3 flex items-center justify-between max-w-5xl mx-auto">
        <h1 className="text-lg font-light tracking-tight">Daily Digest</h1>
        <Link href="/digest" className="text-sm text-accent hover:opacity-80 transition-opacity">
          Back to digest
        </Link>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-light tracking-tight mb-6">Settings</h2>

        <div className="flex gap-1 mb-6 border-b border-card-border">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'Interests' && <InterestManager />}
        {activeTab === 'Sources' && <SourceManager />}
        {activeTab === 'Schedule' && <ScheduleManager />}
        {activeTab === 'Manual URL' && <ManualUrlInput />}
        {activeTab === 'Preferences' && <PreferenceViewer />}
      </main>
    </div>
  );
}
