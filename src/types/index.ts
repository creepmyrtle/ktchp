// Source types
export type SourceType = 'rss' | 'manual_url';

// Sentiment values
export type Sentiment = 'liked' | 'neutral' | 'disliked';

// Feedback actions (append-only event log)
export type FeedbackAction = 'liked' | 'neutral' | 'disliked' | 'read' | 'bookmark' | 'unbookmark' | 'archived';

// User
export interface User {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

// Content Source
export interface Source {
  id: string;
  user_id: string;
  name: string;
  type: SourceType;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

// Ingested Article
export interface Article {
  id: string;
  source_id: string;
  external_id: string | null;
  title: string;
  url: string;
  raw_content: string | null;
  summary: string | null;
  relevance_score: number | null;
  relevance_reason: string | null;
  is_serendipity: boolean;
  provider: string;
  digest_id: string | null;
  published_at: string | null;
  ingested_at: string;
  sentiment: Sentiment | null;
  is_read: boolean;
  is_bookmarked: boolean;
  is_archived: boolean;
  archived_at: string | null;
}

// Article with source info for display
export interface ArticleWithSource extends Article {
  source_name: string;
  source_type: SourceType;
}

// Article engagement state returned by the feedback API
export interface ArticleEngagementState {
  articleId: string;
  sentiment: Sentiment | null;
  is_read: boolean;
  is_bookmarked: boolean;
  is_archived: boolean;
}

// Digest
export interface Digest {
  id: string;
  user_id: string;
  provider: string;
  generated_at: string;
  article_count: number;
}

// Digest with completion stats
export interface DigestWithStats extends Digest {
  total_article_count: number;
  archived_count: number;
  remaining_count: number;
  is_complete: boolean;
}

// User Interest
export interface Interest {
  id: string;
  user_id: string;
  category: string;
  description: string | null;
  weight: number;
  active: boolean;
  created_at: string;
}

// Feedback (append-only event log)
export interface Feedback {
  id: string;
  user_id: string;
  article_id: string;
  action: FeedbackAction;
  created_at: string;
}

// Learned Preference
export interface LearnedPreference {
  id: string;
  user_id: string;
  preference_text: string;
  derived_from_count: number;
  confidence: number;
  updated_at: string;
}

// Claude scoring response
export interface ScoringResult {
  article_id: string;
  relevance_score: number;
  relevance_reason: string;
  is_serendipity: boolean;
}

// Ingestion log event
export interface LogEvent {
  timestamp: string;
  phase: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

// Ingestion log
export interface IngestionLog {
  id: string;
  user_id: string;
  provider: string;
  trigger: 'cron' | 'manual';
  status: 'running' | 'success' | 'error';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  summary: Record<string, unknown>;
  events: LogEvent[];
  error: string | null;
}

// Raw article before storage
export interface RawArticle {
  title: string;
  url: string;
  content: string | null;
  external_id: string;
  published_at: string | null;
  source_id: string;
}
