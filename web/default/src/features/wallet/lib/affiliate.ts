// ============================================================================
// Affiliate Functions
// ============================================================================

/**
 * Generate affiliate registration link.
 * Uses /sign-up (the actual SPA route); /register is also supported via a
 * router redirect for legacy links shared in the past.
 */
export function generateAffiliateLink(affCode: string): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/sign-up?aff=${affCode}`
}
