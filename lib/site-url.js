// Single source of truth for the canonical site URL.
// Set NEXT_PUBLIC_SITE_URL in Vercel env (Production = https://curators.com).
// Falls back to curators.com so production never emits broken links.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://curators.com').replace(/\/$/, '');

// Convenience helper for path joining.
export const siteUrl = (path = '') => `${SITE_URL}${path.startsWith('/') ? path : '/' + path}`;
