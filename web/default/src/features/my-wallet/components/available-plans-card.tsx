import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  Crown,
  Flame,
  Gem,
  Hourglass,
  Layers,
  RefreshCw,
  Repeat,
  Sparkles,
  Timer,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatCnyCurrencyAmount } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import { StatusBadge } from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'
import {
  formatDuration,
  formatResetPeriod,
  formatTimestamp,
} from '@/features/subscriptions/lib'
import type {
  PlanRecord,
  SubscriptionPlan,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import type { MyWalletTopupInfo } from '../types'

interface AvailablePlansCardProps {
  topupInfo: MyWalletTopupInfo | null
  onPurchaseComplete?: () => void
}

type SaleStatus = 'open' | 'upcoming' | 'live' | 'ended'

interface SaleWindow {
  status: SaleStatus
  startsAt: number
  expiresAt: number
  startsIn: number
  endsIn: number
}

function computeSaleWindow(
  plan: SubscriptionPlan,
  nowSec: number
): SaleWindow {
  const startsAt = Number(plan.starts_at || 0)
  const expiresAt = Number(plan.expires_at || 0)
  const startsIn = startsAt > 0 ? startsAt - nowSec : 0
  const endsIn = expiresAt > 0 ? expiresAt - nowSec : 0

  let status: SaleStatus = 'open'
  if (startsAt > 0 && nowSec < startsAt) status = 'upcoming'
  else if (expiresAt > 0 && nowSec >= expiresAt) status = 'ended'
  else if (startsAt > 0 || expiresAt > 0) status = 'live'

  return { status, startsAt, expiresAt, startsIn, endsIn }
}

function formatRelativeDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  if (seconds <= 0) return '0s'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  if (minutes > 0) {
    const remainSec = seconds % 60
    return remainSec > 0 ? `${minutes}m ${remainSec}s` : `${minutes}m`
  }
  return `${seconds}s`
}

export function AvailablePlansCard({
  topupInfo,
  onPurchaseComplete,
}: AvailablePlansCardProps) {
  const { t } = useTranslation()
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [allSubscriptions, setAllSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))

  const hupijiaoEnabled = !!topupInfo?.enable_hupijiao_topup

  const fetchPlans = useCallback(async () => {
    const [planRes, subRes] = await Promise.all([
      getPublicPlans(),
      getSelfSubscriptionFull(),
    ])
    if (planRes.success) setPlans(planRes.data || [])
    if (subRes.success && subRes.data) {
      setAllSubscriptions(subRes.data.all_subscriptions || [])
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        await fetchPlans()
      } finally {
        setLoading(false)
      }
    }
    void init()
  }, [fetchPlans])

  const hasTimedPlan = useMemo(
    () =>
      plans.some(
        (p) => Number(p.plan?.starts_at || 0) > 0 || Number(p.plan?.expires_at || 0) > 0
      ),
    [plans]
  )

  useEffect(() => {
    if (!hasTimedPlan) return
    const id = window.setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      1000
    )
    return () => window.clearInterval(id)
  }, [hasTimedPlan])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchPlans()
    } finally {
      setRefreshing(false)
    }
  }

  const planPurchaseCountMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const sub of allSubscriptions) {
      const planId = sub?.subscription?.plan_id
      if (!planId) continue
      map.set(planId, (map.get(planId) || 0) + 1)
    }
    return map
  }, [allSubscriptions])

  if (loading) {
    return (
      <TitledCard
        title={t('Subscription Plans')}
        icon={<Crown className='h-4 w-4' />}
      >
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className='h-56 w-full rounded-xl' />
          ))}
        </div>
      </TitledCard>
    )
  }

  if (plans.length === 0) {
    return (
      <TitledCard
        title={t('Subscription Plans')}
        icon={<Crown className='h-4 w-4' />}
      >
        <p className='text-muted-foreground py-6 text-center text-sm'>
          {t('No plans available')}
        </p>
      </TitledCard>
    )
  }

  return (
    <>
      <TitledCard
        title={t('Subscription Plans')}
        description={t('Subscribe to a plan for model access')}
        icon={<Crown className='h-4 w-4' />}
        action={
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={cn('h-4 w-4', refreshing && 'animate-spin')}
            />
          </Button>
        }
        contentClassName='space-y-0'
      >
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3'>
          {plans.map((p, index) => {
            const plan = p?.plan
            if (!plan) return null
            const totalAmount = Number(plan.total_amount || 0)
            const price = Number(plan.price_amount || 0).toFixed(2)
            const priceCny = Number(plan.price_cny || 0)
            const isPopular = index === 0 && plans.length > 1
            const limit = Number(plan.max_purchase_per_user || 0)
            const count = planPurchaseCountMap.get(plan.id) || 0
            const reached = limit > 0 && count >= limit
            const soldCount = Number(p.sold_count || 0)
            const resetPeriod = formatResetPeriod(plan, t)
            const hasReset = resetPeriod !== t('No Reset')

            const sale = computeSaleWindow(plan, nowSec)
            const isSaleable = sale.status !== 'upcoming' && sale.status !== 'ended'
            const purchasable = isSaleable && !reached && hupijiaoEnabled
            const endingSoon = sale.status === 'live' && sale.endsIn > 0 && sale.endsIn < 7 * 86400

            const priceLabel = formatCnyCurrencyAmount(priceCny)
            const buttonLabel = reached
              ? t('Limit Reached')
              : sale.status === 'upcoming'
                ? t('Coming Soon')
                : sale.status === 'ended'
                  ? t('Sale Ended')
                  : !hupijiaoEnabled
                    ? t('Online payment disabled by admin')
                    : `${t('Subscribe Now')} · ${priceLabel}`

            return (
              <div
                key={plan.id}
                className={cn(
                  'group relative flex flex-col overflow-hidden rounded-xl border transition-all',
                  isPopular && purchasable
                    ? 'border-primary/40 from-primary/5 to-card bg-gradient-to-br shadow-sm'
                    : 'bg-card hover:border-foreground/30 hover:shadow-sm',
                  !isSaleable && 'opacity-80'
                )}
              >
                {isPopular && purchasable ? (
                  <div className='from-primary/15 absolute inset-x-0 top-0 h-1 bg-gradient-to-r to-transparent' />
                ) : null}

                <div className='flex flex-col gap-2 p-4 pb-3'>
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0 flex-1'>
                      <h4 className='text-base font-semibold tracking-tight'>
                        {plan.title || t('Subscription Plans')}
                      </h4>
                      {plan.subtitle ? (
                        <p className='text-muted-foreground line-clamp-3 text-xs'>
                          {plan.subtitle}
                        </p>
                      ) : null}
                    </div>
                    <div className='flex flex-col items-end gap-1'>
                      {sale.status === 'upcoming' ? (
                        <StatusBadge
                          variant='info'
                          copyable={false}
                          showDot={false}
                          className='shrink-0'
                        >
                          <Hourglass className='size-3' />
                          {t('Coming Soon')}
                        </StatusBadge>
                      ) : sale.status === 'ended' ? (
                        <StatusBadge
                          variant='neutral'
                          copyable={false}
                          showDot={false}
                          className='shrink-0'
                        >
                          {t('Sale Ended')}
                        </StatusBadge>
                      ) : sale.status === 'live' ? (
                        <StatusBadge
                          variant={endingSoon ? 'warning' : 'info'}
                          copyable={false}
                          showDot={false}
                          className='shrink-0'
                          pulse={endingSoon}
                        >
                          <Timer className='size-3' />
                          {t('Limited Time')}
                        </StatusBadge>
                      ) : isPopular ? (
                        <StatusBadge
                          variant='info'
                          copyable={false}
                          className='shrink-0'
                        >
                          <Sparkles className='size-3' />
                          {t('Recommended')}
                        </StatusBadge>
                      ) : null}
                      {soldCount > 0 ? (
                        <StatusBadge
                          variant='warning'
                          copyable={false}
                          showDot={false}
                          className='shrink-0'
                        >
                          <Flame className='size-3' />
                          {t('Sold {{count}}', { count: soldCount })}
                        </StatusBadge>
                      ) : null}
                    </div>
                  </div>

                  <div className='flex items-baseline gap-1.5 pt-1'>
                    <span className='text-muted-foreground/80 text-sm font-medium'>
                      $
                    </span>
                    <span
                      className={cn(
                        'text-3xl font-bold tracking-tight tabular-nums',
                        isPopular && purchasable && 'text-primary'
                      )}
                    >
                      {price}
                    </span>
                    <span className='text-muted-foreground ml-1 text-xs'>
                      / {formatDuration(plan, t)}
                    </span>
                  </div>
                </div>

                <div className='border-t px-4 py-3'>
                  <dl className='grid grid-cols-3 gap-1 text-center text-xs'>
                    <div className='space-y-1'>
                      <dt className='text-muted-foreground/70 inline-flex items-center justify-center gap-1 text-[10px] font-medium tracking-wider uppercase'>
                        <Gem className='size-3' />
                        {t('Quota')}
                      </dt>
                      <dd className='truncate text-sm font-semibold tabular-nums'>
                        {totalAmount > 0
                          ? formatQuota(totalAmount)
                          : t('Unlimited')}
                      </dd>
                    </div>
                    <div className='space-y-1 border-x'>
                      <dt className='text-muted-foreground/70 inline-flex items-center justify-center gap-1 text-[10px] font-medium tracking-wider uppercase'>
                        <CalendarClock className='size-3' />
                        {t('Validity')}
                      </dt>
                      <dd className='truncate text-sm font-semibold'>
                        {formatDuration(plan, t)}
                      </dd>
                    </div>
                    <div className='space-y-1'>
                      <dt className='text-muted-foreground/70 inline-flex items-center justify-center gap-1 text-[10px] font-medium tracking-wider uppercase'>
                        <Repeat className='size-3' />
                        {t('Reset')}
                      </dt>
                      <dd className='truncate text-sm font-semibold'>
                        {hasReset ? resetPeriod : '—'}
                      </dd>
                    </div>
                  </dl>
                </div>

                {sale.status === 'upcoming' ? (
                  <div className='border-t px-4 py-2.5 text-xs'>
                    <div className='text-info inline-flex items-center gap-1.5 font-medium'>
                      <Hourglass className='size-3' />
                      {t('Starts in {{duration}}', {
                        duration: formatRelativeDuration(sale.startsIn),
                      })}
                    </div>
                    <div className='text-muted-foreground/70 mt-0.5'>
                      {t('Sale starts')}: {formatTimestamp(sale.startsAt)}
                    </div>
                  </div>
                ) : sale.status === 'ended' ? (
                  <div className='text-muted-foreground border-t px-4 py-2.5 text-xs'>
                    {t('Sale ended at')}: {formatTimestamp(sale.expiresAt)}
                  </div>
                ) : sale.status === 'live' && sale.expiresAt > 0 ? (
                  <div className='border-t px-4 py-2.5 text-xs'>
                    <div
                      className={cn(
                        'inline-flex items-center gap-1.5 font-medium',
                        endingSoon ? 'text-warning' : 'text-muted-foreground'
                      )}
                    >
                      <Timer className='size-3' />
                      {t('Ends in {{duration}}', {
                        duration: formatRelativeDuration(sale.endsIn),
                      })}
                    </div>
                    <div className='text-muted-foreground/70 mt-0.5'>
                      {t('Sale ends')}: {formatTimestamp(sale.expiresAt)}
                    </div>
                  </div>
                ) : null}

                {(plan.upgrade_group || limit > 0) && (
                  <div className='text-muted-foreground border-t px-4 py-2 text-xs'>
                    <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                      {plan.upgrade_group ? (
                        <span className='inline-flex items-center gap-1'>
                          <Layers className='size-3' />
                          {t('Upgrade Group')}: {plan.upgrade_group}
                        </span>
                      ) : null}
                      {limit > 0 ? (
                        <span className='inline-flex items-center gap-1'>
                          <Users className='size-3' />
                          {t('Purchase Limit')}: {count}/{limit}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}

                <div className='mt-auto p-3 pt-2'>
                  {reached ? (
                    <Tooltip>
                      <TooltipTrigger render={<div />}>
                        <Button
                          variant='outline'
                          className='w-full'
                          disabled
                        >
                          {t('Limit Reached')}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t('Purchase limit reached')} ({count}/{limit})
                      </TooltipContent>
                    </Tooltip>
                  ) : !hupijiaoEnabled && isSaleable ? (
                    <Tooltip>
                      <TooltipTrigger render={<div />}>
                        <Button
                          variant='outline'
                          className='w-full'
                          disabled
                        >
                          {t('Online payment disabled by admin')}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t(
                          'Contact the administrator to re-enable online payment.'
                        )}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      variant={
                        isPopular && purchasable ? 'default' : 'outline'
                      }
                      className='w-full'
                      disabled={!purchasable}
                      onClick={() => {
                        setSelectedPlan(p)
                        setPurchaseOpen(true)
                      }}
                    >
                      {buttonLabel}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </TitledCard>

      <SubscriptionPurchaseDialog
        open={purchaseOpen}
        onOpenChange={(open) => {
          setPurchaseOpen(open)
          if (!open) {
            void fetchPlans()
            onPurchaseComplete?.()
          }
        }}
        plan={selectedPlan}
        enableHupijiao={hupijiaoEnabled}
        purchaseLimit={
          selectedPlan?.plan?.max_purchase_per_user
            ? Number(selectedPlan.plan.max_purchase_per_user)
            : undefined
        }
        purchaseCount={
          selectedPlan?.plan?.id
            ? planPurchaseCountMap.get(selectedPlan.plan.id)
            : undefined
        }
      />
    </>
  )
}
