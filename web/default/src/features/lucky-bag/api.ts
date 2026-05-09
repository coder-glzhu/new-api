import { api } from '@/lib/api'
import type { LuckyBagStatusResponse, LuckyBagHistoryResponse } from './types'

interface ApiResponse<T> {
  success: boolean
  message?: string
  data: T
}

export async function getLuckyBagStatus(): Promise<ApiResponse<LuckyBagStatusResponse>> {
  const res = await api.get('/api/lucky-bag/status')
  return res.data
}

export async function enterLuckyBag(): Promise<ApiResponse<{ entry: unknown }>> {
  const res = await api.post('/api/lucky-bag/enter')
  return res.data
}

export async function getLuckyBagHistory(
  page = 1,
  size = 10
): Promise<ApiResponse<LuckyBagHistoryResponse>> {
  const res = await api.get('/api/lucky-bag/history', { params: { page, size } })
  return res.data
}
