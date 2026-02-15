// Source types
export type SourceType = 'rss' | 'manual_url';

// Feedback actions
export type FeedbackAction = 'thumbs_up' | 'thumbs_down' | 'bookmark' | 'dismiss' | 'click';

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
}

// Article with source info for display
export interface ArticleWithSource extends Article {
  source_name: string;
  source_type: SourceType;
}

// Digest
export interface Digest {
  id: string;
  user_id: string;
  provider: string;
  generated_at: string;
  article_count: number;
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

// Feedback
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
  summary: string;
  relevance_reason: string;
  is_serendipity: boolean;
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
