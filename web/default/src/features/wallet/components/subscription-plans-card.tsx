/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  Check,
  Clock,
  Crown,
  Flame,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCountdown } from '@/features/subscriptions/lib/useCountdown'
import { formatCnyCurrencyAmount } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
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

function getSaleWindowDays(startsAt: number, expiresAt: number): number | null {
  if (expiresAt <= 0) return null
  const base = startsAt > 0 ? startsAt : Math.floor(Date.now() / 1000)
  const seconds = expiresAt - base
  if (seconds <= 0) return null
  return Math.max(1, Math.ceil(seconds / 86400))
}

function SaleWindowBadge({
  startsAt,
  expiresAt,
}: {
  startsAt: number
  expiresAt: number
}) {
  const { t } = useTranslation()
  const endRemaining = useCountdown(expiresAt)
  const saleDays = getSaleWindowDays(startsAt, expiresAt)

  if (!saleDays || expiresAt <= 0) return null
  if (endRemaining <= 0) return null

  return (
    <StatusBadge variant='orange' copyable={false} className='shrink-0'>
      <Flame className='h-3 w-3' />
      {t('Limited {{days}}-day sale', { days: saleDays })}
    </StatusBadge>
  )
}

function SoldCountChip({ count }: { count: number }) {
  const { t } = useTranslation()

  return (
    <span className='text-muted-foreground inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums'>
      <Flame className='h-3 w-3 text-orange-500/80' />
      {t('Sold {{count}}', { count })}
    </span>
  )
}

function PlanActionButton({
  startsAt,
  expiresAt,
  onClick,
}: {
  startsAt: number
  expiresAt: number
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
      <div className='bg-card ring-foreground/10 rounded-xl p-5 ring-1'>
        <div className='mb-5 flex items-center gap-3'>
          <Skeleton className='size-8 rounded-lg' />
          <Skeleton className='h-5 w-32' />
        </div>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-52 w-full rounded-xl' />
          ))}
        </div>
      </div>
    )
  }

  if (plans.length === 0) return null

  return (
    <>
      <div className='bg-card ring-foreground/10 flex flex-col gap-5 rounded-xl p-5 ring-1'>
        {/* Section header */}
        <div className='flex items-center gap-3'>
          <div className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg'>
            <Crown className='text-muted-foreground size-4' />
          </div>
          <div>
            <h3 className='text-sm font-semibold'>{t('Subscription Plans')}</h3>
            <p className='text-muted-foreground mt-0.5 text-xs'>
              {t('Purchase a plan to enjoy model benefits')}
            </p>
          </div>
        </div>

        {/* Plans grid */}
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 2xl:gap-4'>
          {plans.map((p, index) => {
            const plan = p?.plan
            if (!plan) return null
            const totalAmount = Number(plan.total_amount || 0)
            const priceCNY = Number(plan.price_cny || 0)
            const price = Number(plan.price_amount || 0).toFixed(2)
            const displayPrice =
              priceCNY > 0
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
            const soldCount = Number(p.sold_count || 0)

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
              <div
                key={plan.id}
                className={cn(
                  'flex flex-col rounded-xl border p-4 transition-shadow hover:shadow-sm',
                  isPopular && 'border-primary/50'
                )}
              >
                {/* Plan header */}
                <div className='mb-3 space-y-1'>
                  <div className='flex items-start justify-between gap-2'>
                    <h4 className='min-w-0 truncate text-sm font-semibold'>
                      {plan.title || t('Subscription Plans')}
                    </h4>
                    <div className='flex shrink-0 flex-wrap items-center justify-end gap-1.5'>
                      <SaleWindowBadge
                        startsAt={startsAt}
                        expiresAt={expiresAt}
                      />
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
                  </div>
                  {plan.subtitle && (
                    <p className='text-muted-foreground truncate text-xs'>
                      {plan.subtitle}
                    </p>
                  )}
                </div>

                {/* Price */}
                <div className='flex items-end justify-between gap-2 py-2'>
                  <span className='text-primary text-2xl font-bold tracking-tight'>
                    {displayPrice}
                  </span>
                  <SoldCountChip count={soldCount} />
                </div>

                {/* Benefits */}
                <div className='flex-1 space-y-1.5 py-2'>
                  {benefits.map((label) => (
                    <div
                      key={label}
                      className='text-muted-foreground flex items-start gap-2 text-xs'
                    >
                      <Check className='text-primary mt-0.5 h-3 w-3 shrink-0' />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>

                <Separator className='my-3' />

                {/* CTA */}
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
              </div>
            )
          })}
        </div>
      </div>

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
