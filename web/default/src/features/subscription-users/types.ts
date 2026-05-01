export interface SubscriptionUserOverview {
  user_id: number
  username: string
  display_name: string
  email: string
  group: string
  user_status: number
  role: number
  wallet_quota: number
  wallet_used: number
  request_count: number
  status: 'active' | 'expired' | 'cancelled'
  subscription_count: number
  active_count: number
  expired_count: number
  cancelled_count: number
  active_amount_total: number
  active_amount_used: number
  active_amount_remaining: number
  all_amount_total: number
  all_amount_used: number
  current_subscription_id: number
  current_plan_id: number
  current_plan_title: string
  current_source: string
  current_end_time: number
  next_reset_time: number
  last_subscription_time: number
}

export interface SubscriptionUsersOverviewResponse {
  success: boolean
  message?: string
  data?: {
    items: SubscriptionUserOverview[]
    total: number
    page: number
    page_size: number
    summary: SubscriptionUsersOverviewSummary
  }
}

export interface SubscriptionUsersOverviewSummary {
  total_users: number
  active_users: number
  expired_users: number
  cancelled_users: number
  active_amount_total: number
  active_amount_used: number
  active_amount_remaining: number
  expiring_soon_users: number
}

export interface SubscriptionUsersOverviewParams {
  p?: number
  page_size?: number
  keyword?: string
  status?: string
  plan_id?: number
}
