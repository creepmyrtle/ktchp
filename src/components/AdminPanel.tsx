'use client';

import { useState } from 'react';
import UserManager from './UserManager';
import InviteCodeManager from './InviteCodeManager';
import ScoringSettings from './ScoringSettings';
import AnalyticsDashboard from './AnalyticsDashboard';
import CostDashboard from './CostDashboard';

const ADMIN_TABS = ['Users', 'Invite Codes', 'Scoring', 'Analytics'] as const;
type AdminTab = (typeof ADMIN_TABS)[number];

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState<AdminTab>('Users');

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 mb-4">
        {ADMIN_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 text-xs rounded-full transition-colors border ${
              activeTab === tab
                ? 'bg-accent-light text-accent border-accent'
                : 'border-card-border text-muted hover:text-foreground hover:border-border-hover'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Users' && <UserManager />}
      {activeTab === 'Invite Codes' && <InviteCodeManager />}
      {activeTab === 'Scoring' && <ScoringSettings />}
      {activeTab === 'Analytics' && (
        <div className="space-y-10">
          <AnalyticsDashboard />
          <div className="border-t border-card-border pt-8">
            <CostDashboard />
          </div>
        </div>
      )}
    </div>
  );
}
