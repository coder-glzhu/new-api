import { useCallback, useState } from 'react'
import { AvailablePlansCard } from './available-plans-card'
import { MySubscriptionsCard } from './my-subscriptions-card'
import type { MyWalletTopupInfo } from '../types'

interface SubscriptionTabProps {
  topupInfo: MyWalletTopupInfo | null
  onPurchaseComplete?: () => void
}

export function SubscriptionTab({
  topupInfo,
  onPurchaseComplete,
}: SubscriptionTabProps) {
  const [refreshSignal, setRefreshSignal] = useState(0)
  const triggerRefresh = useCallback(() => {
    setRefreshSignal((n) => n + 1)
    onPurchaseComplete?.()
  }, [onPurchaseComplete])

  return (
    <div className='grid gap-4 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)] xl:items-start'>
      <MySubscriptionsCard refreshSignal={refreshSignal} />
      <AvailablePlansCard
        topupInfo={topupInfo}
        onPurchaseComplete={triggerRefresh}
      />
    </div>
  )
}
