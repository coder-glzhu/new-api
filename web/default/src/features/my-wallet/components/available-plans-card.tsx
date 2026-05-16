import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Crown, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
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
  const total = Math.max(0, Math.floor(totalSeconds))
  if (total <= 0) return '00:00:00'
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  if (days > 0) return `${days}d ${hh}:${mm}:${ss}`
  return `${hh}:${mm}:${ss}`
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
        (p) =>
          Number(p.plan?.starts_at || 0) > 0 ||
          Number(p.plan?.expires_at || 0) > 0
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
            <Skeleton key={i} className='h-72 w-full rounded-xl' />
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
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3'>
          {plans.map((p, index) => {
            const plan = p?.plan
            if (!plan) return null

            const totalAmount = Number(plan.total_amount || 0)
            const priceUsd = Number(plan.price_amount || 0)
            const priceCny = Number(plan.price_cny || 0)
            const hasCny = priceCny > 0

            const isPopular = index === 0 && plans.length > 1
            const limit = Number(plan.max_purchase_per_user || 0)
            const count = planPurchaseCountMap.get(plan.id) || 0
            const reached = limit > 0 && count >= limit
            const soldCount = Number(p.sold_count || 0)
            const resetPeriod = formatResetPeriod(plan, t)
            const hasReset = resetPeriod !== t('No Reset')

            const sale = computeSaleWindow(plan, nowSec)
            const isSaleable =
              sale.status !== 'upcoming' && sale.status !== 'ended'
            const purchasable = isSaleable && !reached && hupijiaoEnabled

            const quotaLabel =
              totalAmount > 0 ? formatQuota(totalAmount) : t('Unlimited')

            // Bullet points (always 4 items for visual alignment)
            const bullets: string[] = [
              t('{{quota}} quota', { quota: quotaLabel }),
              t('{{duration}} validity', { duration: formatDuration(plan, t) }),
              hasReset
                ? t('Resets {{period}}', { period: resetPeriod })
                : t('No reset'),
              limit > 0
                ? t('Purchased {{count}} of {{limit}}', { count, limit })
                : t('Unlimited purchases'),
            ]

            // Footer hint (only for live/ended; upcoming countdown lives on the button)
            let footerHint: string | null = null
            if (sale.status === 'ended') {
              footerHint = `${t('Sale ended at')} ${formatTimestamp(sale.expiresAt)}`
            } else if (sale.status === 'live' && sale.expiresAt > 0) {
              footerHint = `${t('Ends in')} ${formatRelativeDuration(sale.endsIn)}`
            }

            const buttonLabel = reached
              ? t('Limit Reached')
              : sale.status === 'upcoming'
                ? `${t('Starts in')} ${formatRelativeDuration(sale.startsIn)}`
                : sale.status === 'ended'
                  ? t('Sale Ended')
                  : t('Subscribe Now')

            return (
              <div
                key={plan.id}
                className={cn(
                  'group bg-card relative flex flex-col rounded-2xl border p-6 transition-all',
                  isPopular && purchasable
                    ? 'border-primary shadow-md ring-1 ring-primary/5'
                    : 'hover:border-foreground/20 hover:shadow-sm'
                )}
              >
                {/* Recommended pill — top-right, only marker for popular */}
                {isPopular && purchasable ? (
                  <div className='bg-primary text-primary-foreground absolute -top-2.5 right-6 rounded-full px-3 py-0.5 text-[10px] font-semibold tracking-wider uppercase'>
                    {t('Recommended')}
                  </div>
                ) : null}

                {/* Title (fixed height: 1-line title + 2-line subtitle) */}
                <div className='h-[4.5rem]'>
                  <h4 className='line-clamp-1 text-lg font-semibold tracking-tight'>
                    {plan.title || t('Subscription Plans')}
                  </h4>
                  <p className='text-muted-foreground mt-1 line-clamp-2 text-sm leading-snug'>
                    {plan.subtitle || ' '}
                  </p>
                </div>

                {/* Price (hero) */}
                <div className='mt-2 mb-1'>
                  <div className='flex items-baseline gap-1'>
                    <span className='text-foreground/60 text-xl font-medium'>
                      {hasCny ? '¥' : '$'}
                    </span>
                    <span className='text-5xl font-bold tracking-tight tabular-nums'>
                      {hasCny
                        ? Math.round(priceCny).toString()
                        : priceUsd.toFixed(0)}
                    </span>
                    <span className='text-muted-foreground ml-1 text-sm'>
                      / {formatDuration(plan, t)}
                    </span>
                  </div>
                  {soldCount > 0 ? (
                    <p className='text-muted-foreground mt-1 text-xs'>
                      {t('Sold {{count}}', { count: soldCount })}
                    </p>
                  ) : (
                    <p className='text-muted-foreground mt-1 text-xs'>&nbsp;</p>
                  )}
                </div>

                {/* Feature bullets (fixed 4 items) */}
                <ul className='mt-4 space-y-2.5 text-sm'>
                  {bullets.map((item, i) => (
                    <li key={i} className='flex items-start gap-2'>
                      <Check
                        className={cn(
                          'mt-0.5 size-4 shrink-0',
                          isPopular && purchasable
                            ? 'text-primary'
                            : 'text-muted-foreground/60'
                        )}
                      />
                      <span className='text-foreground/80'>{item}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className='mt-auto pt-4'>
                  {!hupijiaoEnabled && isSaleable && !reached ? (
                    <Tooltip>
                      <TooltipTrigger render={<div />}>
                        <Button
                          variant='outline'
                          className='h-11 w-full text-base'
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
                      className={cn(
                        'h-11 w-full text-base font-medium',
                        sale.status === 'upcoming' && 'tabular-nums'
                      )}
                      disabled={!purchasable}
                      onClick={() => {
                        setSelectedPlan(p)
                        setPurchaseOpen(true)
                      }}
                    >
                      {buttonLabel}
                    </Button>
                  )}

                  {footerHint ? (
                    <p className='text-muted-foreground mt-1.5 text-center text-xs tabular-nums'>
                      {footerHint}
                    </p>
                  ) : null}
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
