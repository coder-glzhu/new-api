import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Check, Clock, Crown, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCountdown } from '@/features/subscriptions/lib/useCountdown'
import { formatCnyCurrencyAmount } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/status-badge'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'
import { formatDuration, formatResetPeriod } from '@/features/subscriptions/lib'
import type { PlanRecord } from '@/features/subscriptions/types'
import type { PaymentMethod, TopupInfo } from '../types'

interface SubscriptionPlansCardProps {
  topupInfo: TopupInfo | null
  onAvailabilityChange?: (available: boolean) => void
}

function getEpayMethods(
  payMethods: PaymentMethod[] = [],
  routeAlipayThroughHupijiao = false
): PaymentMethod[] {
  return payMethods.filter(
    (m) =>
      m?.type &&
      m.type !== 'stripe' &&
      m.type !== 'creem' &&
      m.type !== 'hupijiao' &&
      (!routeAlipayThroughHupijiao || m.type !== 'alipay')
  )
}

function formatCountdownText(remaining: number): string {
  if (remaining <= 0) return ''
  const days = Math.floor(remaining / 86400)
  const h = String(Math.floor((remaining % 86400) / 3600)).padStart(2, '0')
  const m = String(Math.floor((remaining % 3600) / 60)).padStart(2, '0')
  const s = String(remaining % 60).padStart(2, '0')
  return days > 0 ? `${days}d ${h}:${m}:${s}` : `${h}:${m}:${s}`
}

// 单个按钮组件，内部用 useCountdown 驱动全部状态切换，无需父组件重渲染
function PlanActionButton({
  startsAt,
  expiresAt,
  onClick,
}: {
  startsAt: number   // 0 = 无限制
  expiresAt: number  // 0 = 无限制
  onClick: () => void
}) {
  const { t } = useTranslation()
  const startRemaining = useCountdown(startsAt)
  const endRemaining = useCountdown(expiresAt)

  const notYetOnSale = startsAt > 0 && startRemaining > 0
  const saleEnded = expiresAt > 0 && endRemaining <= 0
  const hasExpiry = expiresAt > 0 && endRemaining > 0

  if (notYetOnSale) {
    const countdown = formatCountdownText(startRemaining)
    return (
      <Button
        disabled
        className={cn(
          'w-full cursor-not-allowed',
          'bg-gradient-to-r from-indigo-500 to-sky-500',
          'text-white opacity-100 shadow-sm',
          'disabled:opacity-100'
        )}
      >
        <CalendarClock className='mr-1.5 h-3.5 w-3.5 shrink-0' />
        <span>{t('Starts in')}</span>
        <span className='ml-1.5 font-mono font-semibold tabular-nums'>
          {countdown}
        </span>
      </Button>
    )
  }

  if (saleEnded) {
    return (
      <Button variant='outline' className='w-full' disabled>
        {t('Sale Ended')}
      </Button>
    )
  }

  if (hasExpiry) {
    const countdown = formatCountdownText(endRemaining)
    return (
      <Button
        className='w-full bg-gradient-to-r from-rose-500 to-orange-500 text-white shadow-sm hover:from-rose-600 hover:to-orange-600'
        onClick={onClick}
      >
        <Clock className='mr-1.5 h-3.5 w-3.5' />
        <span>{t('Subscribe Now')}</span>
        <span className='ml-1.5 opacity-90'>·</span>
        <span className='ml-1.5 font-mono tabular-nums opacity-95'>
          {t('Ends in {{countdown}}', { countdown })}
        </span>
      </Button>
    )
  }

  return (
    <Button variant='outline' className='w-full' onClick={onClick}>
      {t('Subscribe Now')}
    </Button>
  )
}

export function SubscriptionPlansCard({
  topupInfo,
  onAvailabilityChange,
}: SubscriptionPlansCardProps) {
  const { t } = useTranslation()

  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [planPurchaseCountMap, setPlanPurchaseCountMap] = useState<
    Map<number, number>
  >(new Map())
  const [loading, setLoading] = useState(true)

  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null)

  const enableStripe = !!topupInfo?.enable_stripe_topup
  const enableCreem = !!topupInfo?.enable_creem_topup
  const alipayMethod = useMemo(
    () => topupInfo?.pay_methods?.find((m) => m.type === 'alipay'),
    [topupInfo?.pay_methods]
  )
  const enableHupijiao =
    !!topupInfo?.enable_hupijiao_topup && !!alipayMethod
  const enableOnlineTopUp = !!topupInfo?.enable_online_topup
  const epayMethods = useMemo(
    () => getEpayMethods(topupInfo?.pay_methods, enableHupijiao),
    [topupInfo?.pay_methods, enableHupijiao]
  )

  const fetchPlans = useCallback(async () => {
    try {
      const res = await getPublicPlans()
      if (res.success) setPlans(res.data || [])
    } catch {
      setPlans([])
    }
  }, [])

  const fetchPurchaseCounts = useCallback(async () => {
    try {
      const res = await getSelfSubscriptionFull()
      if (res.success && res.data) {
        const map = new Map<number, number>()
        for (const sub of res.data.all_subscriptions || []) {
          const planId = sub?.subscription?.plan_id
          if (!planId) continue
          map.set(planId, (map.get(planId) || 0) + 1)
        }
        setPlanPurchaseCountMap(map)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([fetchPlans(), fetchPurchaseCounts()])
      setLoading(false)
    }
    init()
  }, [fetchPlans, fetchPurchaseCounts])

  const isAvailable = loading || plans.length > 0
  useEffect(() => {
    onAvailabilityChange?.(isAvailable)
  }, [isAvailable, onAvailabilityChange])

  if (loading) {
    return (
      <Card className='gap-0 overflow-hidden py-0'>
        <CardHeader className='border-b p-3 !pb-3 sm:p-5 sm:!pb-5'>
          <Skeleton className='h-6 w-32' />
        </CardHeader>
        <CardContent className='p-3 sm:p-5'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className='h-48 w-full' />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (plans.length === 0) return null

  return (
    <>
      <TitledCard
        title={t('Subscription Plans')}
        description={t('Purchase a plan to enjoy model benefits')}
        icon={<Crown className='h-4 w-4' />}
        contentClassName='flex flex-col gap-4 sm:gap-5'
      >
        {/* Available plans grid */}
        {plans.length > 0 ? (
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 2xl:gap-4'>
            {plans.map((p, index) => {
              const plan = p?.plan
              if (!plan) return null
              const totalAmount = Number(plan.total_amount || 0)
              const priceCNY = Number(plan.price_cny || 0)
              const price = Number(plan.price_amount || 0).toFixed(2)
              const displayPrice =
                enableHupijiao && priceCNY > 0
                  ? formatCnyCurrencyAmount(priceCNY, {
                      digitsLarge: 2,
                      digitsSmall: 2,
                      abbreviate: false,
                    })
                  : `$${price}`
              const isPopular = index === 0 && plans.length > 1
              const limit = Number(plan.max_purchase_per_user || 0)
              const count = planPurchaseCountMap.get(plan.id) || 0
              const reached = limit > 0 && count >= limit

              const startsAt = Number(plan.starts_at || 0)
              const expiresAt = Number(plan.expires_at || 0)

              const benefits = [
                `${t('Validity Period')}: ${formatDuration(plan, t)}`,
                formatResetPeriod(plan, t) !== t('No Reset')
                  ? `${t('Quota Reset')}: ${formatResetPeriod(plan, t)}`
                  : null,
                totalAmount > 0
                  ? `${t('Total Quota')}: ${formatQuota(totalAmount)}`
                  : `${t('Total Quota')}: ${t('Unlimited')}`,
                limit > 0 ? `${t('Purchase Limit')}: ${limit}` : null,
                plan.upgrade_group
                  ? `${t('Upgrade Group')}: ${plan.upgrade_group}`
                  : null,
              ].filter(Boolean) as string[]

              return (
                <Card
                  key={plan.id}
                  className={cn(
                    'transition-shadow hover:shadow-md',
                    isPopular && 'border-primary/70 shadow-sm'
                  )}
                >
                  <CardContent className='flex h-full flex-col p-3.5 sm:p-4'>
                    <div className='mb-2 flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <h4 className='truncate font-semibold'>
                          {plan.title || t('Subscription Plans')}
                        </h4>
                        {plan.subtitle && (
                          <p className='text-muted-foreground truncate text-xs'>
                            {plan.subtitle}
                          </p>
                        )}
                      </div>
                      {isPopular && (
                        <StatusBadge
                          variant='info'
                          copyable={false}
                          className='shrink-0'
                        >
                          <Sparkles className='h-3 w-3' />
                          {t('Recommended')}
                        </StatusBadge>
                      )}
                    </div>

                    <div className='py-2'>
                      <span className='text-primary text-2xl font-bold'>
                        {displayPrice}
                      </span>
                    </div>

                    <div className='flex-1 space-y-1.5 pb-3'>
                      {benefits.map((label) => (
                        <div
                          key={label}
                          className='text-muted-foreground flex items-center gap-2 text-xs'
                        >
                          <Check className='text-primary h-3 w-3 shrink-0' />
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>

                    <Separator className='mb-3' />

                    {reached ? (
                      <Tooltip>
                        <TooltipTrigger render={<div />}>
                          <Button variant='outline' className='w-full' disabled>
                            {t('Limit Reached')}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('Purchase limit reached')} ({count}/{limit})
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <PlanActionButton
                        startsAt={startsAt}
                        expiresAt={expiresAt}
                        onClick={() => {
                          setSelectedPlan(p)
                          setPurchaseOpen(true)
                        }}
                      />
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <p className='text-muted-foreground py-4 text-center text-sm'>
            {t('No plans available')}
          </p>
        )}
      </TitledCard>

      <SubscriptionPurchaseDialog
        open={purchaseOpen}
        onOpenChange={(open) => {
          setPurchaseOpen(open)
          if (!open) {
            fetchPurchaseCounts()
          }
        }}
        plan={selectedPlan}
        enableStripe={enableStripe}
        enableCreem={enableCreem}
        enableHupijiao={enableHupijiao}
        hupijiaoPaymentMethodName={alipayMethod?.name}
        enableOnlineTopUp={enableOnlineTopUp}
        epayMethods={epayMethods}
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
