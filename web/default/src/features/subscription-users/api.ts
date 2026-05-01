import { api } from '@/lib/api'
import type {
  SubscriptionUsersOverviewParams,
  SubscriptionUsersOverviewResponse,
} from './types'

export async function getSubscriptionUsersOverview(
  params: SubscriptionUsersOverviewParams
): Promise<SubscriptionUsersOverviewResponse> {
  const res = await api.get('/api/subscription/admin/users/overview', {
    params,
  })
  return res.data
}
