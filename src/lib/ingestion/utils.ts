/**
 * Normalize a URL for deduplication:
 * - Strip utm_* and tracking params
 * - Normalize trailing slashes
 * - Lowercase hostname
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    // Remove tracking params
    const paramsToRemove: string[] = [];
    url.searchParams.forEach((_, key) => {
      if (key.startsWith('utm_') || key === 'ref' || key === 'source') {
        paramsToRemove.push(key);
      }
    });
    for (const key of paramsToRemove) {
      url.searchParams.delete(key);
    }
    // Normalize
    url.hostname = url.hostname.toLowerCase();
    let normalized = url.toString();
    // Remove trailing slash for consistency (unless it's just the origin)
    if (normalized.endsWith('/') && url.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return rawUrl;
  }
}

/**
 * Generate a hash for dedup purposes
 */
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
