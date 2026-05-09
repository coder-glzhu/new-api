export interface LuckyBagActivity {
  id: number
  draw_date: string
  slot_hour: number   // 9 | 12 | 17
  min_quota: number
  max_quota: number
  status: 'pending' | 'drawn'
  winner_user_id: number
  winner_name: string
  winner_quota: number
  winner_code: string
  drawn_at: number
  created_at: number
}

export interface LuckyBagEntry {
  id: number
  activity_id: number
  user_id: number
  weight: number
  created_at: number
}

export interface LuckyBagStatusResponse {
  today_activities: LuckyBagActivity[]
  next_activity: LuckyBagActivity | null
  entered: boolean
  weight: number
  participant_count: number
}

export interface LuckyBagHistoryResponse {
  activities: LuckyBagActivity[]
  total: number
  page: number
  size: number
}
