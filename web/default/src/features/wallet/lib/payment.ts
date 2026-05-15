/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  PAYMENT_TYPES,
  DEFAULT_PRESET_MULTIPLIERS,
  DEFAULT_PAYMENT_TYPE,
  DEFAULT_MIN_TOPUP,
} from '../constants'
import type { PresetAmount, TopupInfo } from '../types'

// ============================================================================
// Payment Processing Functions
// ============================================================================

/**
 * Check if browser is Safari
 */
function isSafariBrowser(): boolean {
  return (
    navigator.userAgent.indexOf('Safari') > -1 &&
    navigator.userAgent.indexOf('Chrome') < 1
  )
}

/**
 * Submit payment form (for non-Stripe payments)
 */
export function submitPaymentForm(
  url: string,
  params: Record<string, unknown>
): void {
  const form = document.createElement('form')
  form.action = url
  form.method = 'POST'

  // Don't open in new tab for Safari
  if (!isSafariBrowser()) {
    form.target = '_blank'
  }

  // Add form parameters
  Object.entries(params).forEach(([key, value]) => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = key
    input.value = String(value)
    form.appendChild(input)
  })

  document.body.appendChild(form)
  form.submit()
  document.body.removeChild(form)
}

/**
 * Check if payment method is Stripe
 */
export function isStripePayment(paymentType: string): boolean {
  return paymentType === PAYMENT_TYPES.STRIPE
}

/**
 * Check if payment method is Waffo Pancake
 *
 * Pancake is a metered-style payment that goes through a dedicated checkout
 * URL flow rather than the generic epay form submission, so it must be
 * special-cased in payment dispatch logic.
 */
export function isWaffoPancakePayment(paymentType: string): boolean {
  return paymentType === PAYMENT_TYPES.WAFFO_PANCAKE
}

/**
 * Check if payment method is Hupijiao/Alipay
 */
export function isHupijiaoPayment(paymentType: string): boolean {
  return paymentType === PAYMENT_TYPES.HUPIJIAO
}

/**
 * Check if the visible Alipay method should be routed through Hupijiao.
 */
export function shouldRouteAlipayThroughHupijiao(
  topupInfo: TopupInfo | null,
  paymentType: string
): boolean {
  return (
    !!topupInfo?.enable_hupijiao_topup && paymentType === PAYMENT_TYPES.ALIPAY
  )
}

/**
 * Get default payment type from topup info
 */
export function getDefaultPaymentType(topupInfo: TopupInfo | null): string {
  if (!topupInfo) {
    return DEFAULT_PAYMENT_TYPE
  }

  // Return first available payment method or default
  if (topupInfo.pay_methods?.length > 0) {
    return topupInfo.pay_methods[0].type
  }

  if (topupInfo.enable_stripe_topup) {
    return PAYMENT_TYPES.STRIPE
  }

  if (topupInfo.enable_waffo_topup) {
    return PAYMENT_TYPES.WAFFO
  }

  if (topupInfo.enable_waffo_pancake_topup) {
    return PAYMENT_TYPES.WAFFO_PANCAKE
  }

  return DEFAULT_PAYMENT_TYPE
}

/**
 * Get minimum topup amount from topup info
 */
export function getMinTopupAmount(topupInfo: TopupInfo | null): number {
  if (!topupInfo) {
    return DEFAULT_MIN_TOPUP
  }

  if (topupInfo.enable_online_topup) {
    return topupInfo.min_topup
  }

  if (topupInfo.enable_stripe_topup) {
    return topupInfo.stripe_min_topup
  }

  if (topupInfo.enable_waffo_topup) {
    return topupInfo.waffo_min_topup || DEFAULT_MIN_TOPUP
  }

  if (topupInfo.enable_waffo_pancake_topup) {
    return topupInfo.waffo_pancake_min_topup || DEFAULT_MIN_TOPUP
  }

  if (topupInfo.enable_hupijiao_topup) {
    const alipayMethod = topupInfo.pay_methods?.find(
      (method) => method.type === PAYMENT_TYPES.ALIPAY
    )
    // min_topup / hupijiao_min_recharge_amount 为「充值数量」下限；hupijiao_min_topup 为最低实付人民币，勿混用
    const fromMethod = alipayMethod?.min_topup
    if (typeof fromMethod === 'number' && fromMethod > 0) {
      return fromMethod
    }
    const fromApi = topupInfo.hupijiao_min_recharge_amount
    if (typeof fromApi === 'number' && fromApi > 0) {
      return fromApi
    }
    return DEFAULT_MIN_TOPUP
  }

  return DEFAULT_MIN_TOPUP
}

/**
 * Generate preset amounts based on minimum topup
 */
export function generatePresetAmounts(minAmount: number): PresetAmount[] {
  return DEFAULT_PRESET_MULTIPLIERS.map((multiplier) => ({
    value: minAmount * multiplier,
  }))
}

/**
 * Merge custom preset amounts with discounts
 */
export function mergePresetAmounts(
  amountOptions: number[],
  discounts: Record<number, number>
): PresetAmount[] {
  if (!amountOptions || amountOptions.length === 0) {
    return []
  }

  return amountOptions.map((amount) => ({
    value: amount,
    discount: discounts[amount] || 1.0,
  }))
}

/**
 * Preset buttons for the active top-up route: Hupijiao Alipay uses dedicated
 * presets when configured; otherwise same rules as the global list.
 */
export function getPresetAmountsForTopupRoute(
  topupInfo: TopupInfo | null,
  paymentType: string,
  globalPresets: PresetAmount[],
  hupijiaoPresets: PresetAmount[]
): PresetAmount[] {
  if (shouldRouteAlipayThroughHupijiao(topupInfo, paymentType)) {
    if (hupijiaoPresets.length > 0) {
      return hupijiaoPresets
    }
    const min = getMinTopupAmount(topupInfo)
    return generatePresetAmounts(min)
  }
  if (globalPresets.length > 0) {
    return globalPresets
  }
  const min = getMinTopupAmount(topupInfo)
  return generatePresetAmounts(min)
}

/** Price multiplier shown in preset / estimate UI for the selected route. */
export function effectiveTopupPriceRatio(
  topupInfo: TopupInfo | null,
  paymentType: string,
  globalRatio: number
): number {
  if (shouldRouteAlipayThroughHupijiao(topupInfo, paymentType)) {
    const r = topupInfo?.hupijiao_price
    return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : 0
  }
  return globalRatio
}
