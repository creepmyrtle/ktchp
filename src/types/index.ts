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
  is_admin: boolean;
  display_name: string | null;
  is_active: boolean;
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
  is_default: boolean;
  created_by: string | null;
  max_items: number;
  created_at: string;
  last_fetch_error?: string | null;
  last_fetched_at?: string | null;
}

// Ingested Article (shared content only — no per-user scoring/engagement)
export interface Article {
  id: string;
  source_id: string;
  external_id: string | null;
  title: string;
  url: string;
  raw_content: string | null;
  summary: string | null;
  provider: string;
  published_at: string | null;
  ingested_at: string;
}

// Digest tier classification
export type DigestTier = 'recommended' | 'serendipity' | 'bonus';

// Per-user article state (scoring, engagement, digest assignment)
export interface UserArticle {
  id: string;
  user_id: string;
  article_id: string;
  digest_id: string | null;
  digest_tier: DigestTier | null;
  relevance_score: number | null;
  relevance_reason: string | null;
  embedding_score: number | null;
  is_serendipity: boolean;
  sentiment: Sentiment | null;
  is_read: boolean;
  is_bookmarked: boolean;
  is_archived: boolean;
  archived_at: string | null;
  scored_at: string | null;
}

// Embedding (article, interest, or exclusion vector)
export interface Embedding {
  id: string;
  ref_type: 'article' | 'interest' | 'exclusion';
  ref_id: string;
  embedding_text: string;
  created_at: string;
}

// Excluded topic (negative interest)
export interface Exclusion {
  id: string;
  user_id: string;
  category: string;
  description: string | null;
  expanded_description: string | null;
  created_at: string;
}

// Interest suggestion from affinity analysis
export interface InterestSuggestion {
  id: string;
  user_id: string;
  category: string;
  description: string | null;
  related_interests: string[];
  reasoning: string | null;
  confidence: number;
  status: 'pending' | 'accepted' | 'dismissed';
  created_at: string;
  resolved_at: string | null;
}

// Source trust factor cache
export interface SourceTrust {
  id: string;
  user_id: string;
  source_id: string;
  trust_factor: number;
  sample_size: number;
  updated_at: string;
}

// User article joined with article content and source info (replaces ArticleWithSource)
export interface UserArticleWithSource extends UserArticle {
  title: string;
  url: string;
  raw_content: string | null;
  summary: string | null;
  provider: string;
  published_at: string | null;
  ingested_at: string;
  source_id: string;
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
  expanded_description: string | null;
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

// Invite code
export interface InviteCode {
  id: string;
  code: string;
  created_by: string;
  used_by: string | null;
  used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

// User source setting (enable/disable default sources per user)
export interface UserSourceSetting {
  user_id: string;
  source_id: string;
  enabled: boolean;
}
