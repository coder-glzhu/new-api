import {
  DEFAULT_CURRENCY_CONFIG,
  type CurrencyConfig,
} from '@/stores/system-config-store'

export const MIN_TRANSFER_AMOUNT_USD = 1

export function resolveQuotaPerUsd(quotaPerUnit?: number): number {
  return Number.isFinite(quotaPerUnit) && Number(quotaPerUnit) > 0
    ? Number(quotaPerUnit)
    : DEFAULT_CURRENCY_CONFIG.quotaPerUnit
}

export function quotaToUsdAmount(quota: number, quotaPerUnit: number): number {
  return quota / resolveQuotaPerUsd(quotaPerUnit)
}

export function floorUsdToCents(amount: number): number {
  if (!Number.isFinite(amount)) return Number.NaN
  return Math.floor((amount + Number.EPSILON) * 100) / 100
}

export function quotaToTransferableUsdAmount(
  quota: number,
  quotaPerUnit: number
): number {
  const amount = quotaToUsdAmount(quota, quotaPerUnit)
  return floorUsdToCents(amount)
}

export function quotaToUsdDisplayAmount(
  quota: number,
  currency?: Partial<CurrencyConfig>
): number {
  return quotaToUsdAmount(quota, resolveQuotaPerUsd(currency?.quotaPerUnit))
}

export function formatUsdAmount(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}
