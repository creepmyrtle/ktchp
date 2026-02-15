import type { RawArticle } from '@/types';
import { normalizeUrl } from './utils';

export async function processManualUrl(
  sourceId: string,
  url: string
): Promise<RawArticle | null> {
  try {
    const normalizedUrl = normalizeUrl(url);

    const res = await fetch(normalizedUrl, {
      headers: { 'User-Agent': 'DailyDigest/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const html = await res.text();

    // Extract title from HTML
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : normalizedUrl;

    // Extract meta description
    const descMatch = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i
    ) || html.match(
      /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i
    );
    const description = descMatch ? descMatch[1].trim() : null;

    return {
      title,
      url: normalizedUrl,
      content: description,
      external_id: `manual_${normalizedUrl}`,
      published_at: new Date().toISOString(),
      source_id: sourceId,
    };
  } catch (error) {
    console.error(`Failed to process manual URL ${url}:`, error);
    return null;
  }
}
