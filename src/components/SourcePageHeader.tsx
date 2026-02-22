'use client';

import { useState } from 'react';

export default function SourcePageHeader() {
  const [tipsOpen, setTipsOpen] = useState(false);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted leading-relaxed">
        ketchup checks your sources daily and scores new articles against
        your interests. For best results, add sources that publish
        frequently — daily news sites, active blogs, and feeds with
        regular new content work best. Once you&apos;ve rated 5+ articles from
        a source, a trust rating (dots) will appear — sources you
        consistently enjoy get a small boost in your digest scoring.
      </p>

      <div>
        <button
          onClick={() => setTipsOpen(!tipsOpen)}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
        >
          <svg
            className={`w-3 h-3 transition-transform ${tipsOpen ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Tips for choosing good sources
        </button>

        {tipsOpen && (
          <div className="mt-2 text-xs text-muted space-y-3 pl-4 border-l border-card-border">
            <div>
              <p className="font-medium text-foreground mb-1">Works great</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>News sites that publish daily (e.g., Ars Technica, The Verge)</li>
                <li>Active blogs with 2+ posts per week</li>
                <li>Aggregators and link feeds (e.g., Hacker News, Lobsters)</li>
                <li>Subreddit RSS feeds for active communities</li>
              </ul>
            </div>

            <div>
              <p className="font-medium text-foreground mb-1">Works okay but may produce few matches</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Niche blogs that post monthly — content appears when published, but most digests won&apos;t have anything from these</li>
                <li>Broad news feeds (AP, Reuters) — high volume but most articles won&apos;t match your interests</li>
              </ul>
            </div>

            <div>
              <p className="font-medium text-foreground mb-1">Doesn&apos;t work well</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Blogs with deep archives in their feed — only articles from the last 14 days are considered</li>
                <li>Feeds that rarely update (quarterly newsletters, annual reports)</li>
                <li>Paywalled content where the feed only has a headline and no description</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
