import { api } from '@/lib/api'
import type { AmountRequest, AmountResponse } from '@/features/wallet/types'
import type {
  HupijiaoOrderStatusResponse,
  HupijiaoPaymentResponse,
} from './types'

export { isApiSuccess } from '@/features/wallet/api'

export async function calculateHupijiaoAmount(
  request: AmountRequest
): Promise<AmountResponse> {
  const res = await api.post('/api/user/hupijiao/amount', request, {
    skipBusinessError: true,
  } as Record<string, unknown>)
  const data = res.data?.data
  return {
    ...res.data,
    data:
      data && typeof data === 'object' && 'amount' in data
        ? String((data as { amount?: number | string }).amount ?? '')
        : res.data?.data,
  }
}

export async function requestHupijiaoPayment(
  request: AmountRequest
): Promise<HupijiaoPaymentResponse> {
  const res = await api.post('/api/user/hupijiao/pay', request, {
    skipBusinessError: true,
  } as Record<string, unknown>)
  return res.data
}

export async function getHupijiaoTopupOrderStatus(
  tradeNo: string,
  openid?: string
): Promise<HupijiaoOrderStatusResponse> {
  const res = await api.get(
    `/api/user/topup/${encodeURIComponent(tradeNo)}/status`,
    {
      params: openid ? { openid } : undefined,
      skipBusinessError: true,
    } as Record<string, unknown>
  )
  return res.data
}
