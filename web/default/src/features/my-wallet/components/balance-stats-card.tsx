import { WalletStatsCard } from '@/features/wallet/components/wallet-stats-card'
import type { UserWalletData } from '../types'

interface BalanceStatsCardProps {
  user: UserWalletData | null
  loading?: boolean
}

export function BalanceStatsCard({ user, loading }: BalanceStatsCardProps) {
  return <WalletStatsCard user={user} loading={loading} />
}
