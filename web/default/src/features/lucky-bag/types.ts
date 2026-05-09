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
  // 仅历史记录中当前用户中奖时有值：1=未使用 3=已使用 0=非本人中奖
  winner_code_status?: number
}

export interface LuckyBagEntry {
  id: number
  activity_id: number
  user_id: number
  weight: number
  created_at: number
}

export interface LuckyBagResultCard {
  activity: LuckyBagActivity
  is_winner: boolean
  winner_viewed: boolean
}

export interface LuckyBagStatusResponse {
  today_activities: LuckyBagActivity[]
  next_activity: LuckyBagActivity | null
  entered: boolean
  weight: number
  participant_count: number
  result_cards: LuckyBagResultCard[] | null
}

export interface LuckyBagHistoryResponse {
  activities: LuckyBagActivity[]
  total: number
  page: number
  size: number
}
