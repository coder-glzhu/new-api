import { formatTimestampToDate } from '@/lib/format'
import type { StatusBadgeProps } from '@/components/status-badge'
import type { TopupStatus } from '../types'

// ============================================================================
// Billing Utility Functions
// ============================================================================

interface StatusConfig {
  variant: StatusBadgeProps['variant']
  label: string
}

/**
 * Status badge configuration
 */
export const STATUS_CONFIG: Record<TopupStatus, StatusConfig> = {
  success: {
    variant: 'success',
    label: 'Success',
  },
  pending: {
    variant: 'warning',
    label: 'Pending',
  },
  failed: {
    variant: 'danger',
    label: 'Failed',
  },
  expired: {
    variant: 'danger',
    label: 'Expired',
  },
  canceled: {
    variant: 'neutral',
    label: 'Cancelled',
  },
}

/**
 * Get status badge configuration
 */
export function getStatusConfig(status: TopupStatus): StatusConfig {
  return STATUS_CONFIG[status] || STATUS_CONFIG.pending
}

/**
 * Payment method display names
 */
export const PAYMENT_METHOD_NAMES: Record<string, string> = {
  stripe: 'Stripe',
  alipay: 'Alipay',
  hupijiao: 'Alipay',
  wxpay: 'WeChat Pay',
  waffo: 'Waffo',
  waffo_pancake: 'Waffo Pancake',
}

/**
 * Get payment method display name
 */
export function getPaymentMethodName(
  method: string,
  provider?: string
): string {
  if (provider === 'hupijiao' || method === 'hupijiao') return 'Alipay'
  return PAYMENT_METHOD_NAMES[method] || method
}

/**
 * Format timestamp to readable date string
 */
export function formatTimestamp(timestamp: number): string {
  return formatTimestampToDate(timestamp)
}
