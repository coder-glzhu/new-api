import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Wallet as WalletIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  StatusBadge,
  dotColorMap,
  textColorMap,
} from '@/components/status-badge'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
  updateBillingPreference,
} from '@/features/subscriptions/api'
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'

interface MySubscriptionsCardProps {
  onAvailabilityChange?: (available: boolean) => void
}

function getBillingPreferenceLabel(
  preference: string,
  t: (key: string) => string
): string {
  switch (preference) {
    case 'subscription_first':
      return t('Subscription First')
    case 'wallet_first':
      return t('Wallet First')
    case 'subscription_only':
      return t('Subscription Only')
    case 'wallet_only':
      return t('Wallet Only')
    default:
      return preference
  }
}

export function MySubscriptionsCard({
  onAvailabilityChange,
}: MySubscriptionsCardProps) {
  const { t } = useTranslation()

  const [allSubscriptions, setAllSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [activeSubscriptions, setActiveSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [billingPreference, setBillingPreference] =
    useState('subscription_first')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchSelfSubscription = useCallback(async () => {
    try {
      const res = await getSelfSubscriptionFull()
      if (res.success && res.data) {
        setBillingPreference(
          res.data.billing_preference || 'subscription_first'
        )
        setActiveSubscriptions(res.data.subscriptions || [])
        setAllSubscriptions(res.data.all_subscriptions || [])
      }
    } catch {
      // ignore
    }
  }, [])

  const fetchPlansForTitles = useCallback(async () => {
    try {
      const res = await getPublicPlans()
      if (res.success) setPlans(res.data || [])
    } catch {
      setPlans([])
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([fetchSelfSubscription(), fetchPlansForTitles()])
      setLoading(false)
    }
    init()
  }, [fetchSelfSubscription, fetchPlansForTitles])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchSelfSubscription()
    } finally {
      setRefreshing(false)
    }
  }

  const handlePreferenceChange = async (pref: string) => {
    const previous = billingPreference
    setBillingPreference(pref)
    try {
      const res = await updateBillingPreference(pref)
      if (res.success) {
        toast.success(t('Updated successfully'))
        setBillingPreference(res.data?.billing_preference || pref)
      } else {
        toast.error(res.message || t('Update failed'))
        setBillingPreference(previous)
      }
    } catch {
      toast.error(t('Request failed'))
      setBillingPreference(previous)
    }
  }

  const hasActive = activeSubscriptions.length > 0
  const hasAny = allSubscriptions.length > 0
  const disablePref = !hasActive
  const isSubPref =
    billingPreference === 'subscription_first' ||
    billingPreference === 'subscription_only'
  const displayPref =
    disablePref && isSubPref ? 'wallet_first' : billingPreference

  const planTitleMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const p of plans) {
      if (p?.plan?.id) {
        map.set(p.plan.id, p.plan.title || '')
      }
    }
    return map
  }, [plans])

  useEffect(() => {
    onAvailabilityChange?.(hasAny)
  }, [hasAny, onAvailabilityChange])

  const getRemainingDays = (sub: UserSubscriptionRecord) => {
    const endTime = sub?.subscription?.end_time || 0
    if (!endTime) return 0
    const now = Date.now() / 1000
    return Math.max(0, Math.ceil((endTime - now) / 86400))
  }

  const getUsagePercent = (sub: UserSubscriptionRecord) => {
    const total = Number(sub?.subscription?.amount_total || 0)
    const used = Number(sub?.subscription?.amount_used || 0)
    if (total <= 0) return 0
    return Math.round((used / total) * 100)
  }

  if (loading) {
    return (
      <Card className='bg-muted/20 py-0'>
        <CardContent className='p-3 sm:p-4'>
          <Skeleton className='h-8 w-full' />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className='bg-muted/20 py-0'>
      <CardContent className='flex flex-col gap-3 p-3 sm:p-4'>
        {/* 单行：图标 + 标题/状态 + 计费偏好下拉 + 刷新 */}
        <div className='flex items-center gap-2.5'>
          <div className='bg-background flex size-8 shrink-0 items-center justify-center rounded-lg border'>
            <WalletIcon className='text-muted-foreground size-4' />
          </div>

          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5'>
              <h3 className='text-sm font-semibold'>{t('My Subscriptions')}</h3>
              <span className='flex items-center gap-1 text-xs'>
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    hasActive ? dotColorMap.success : dotColorMap.neutral
                  )}
                  aria-hidden='true'
                />
                {hasActive ? (
                  <span className={cn(textColorMap.success)}>
                    {activeSubscriptions.length} {t('active')}
                  </span>
                ) : (
                  <span className='text-muted-foreground'>{t('No Active')}</span>
                )}
                {allSubscriptions.length > activeSubscriptions.length && (
                  <>
                    <span className='text-muted-foreground/30'>·</span>
                    <span className='text-muted-foreground'>
                      {allSubscriptions.length - activeSubscriptions.length}{' '}
                      {t('expired')}
                    </span>
                  </>
                )}
              </span>
            </div>
          </div>

          <div className='flex shrink-0 items-center gap-1'>
            <Select
              items={[
                {
                  value: 'subscription_first',
                  label: (
                    <>
                      {getBillingPreferenceLabel('subscription_first', t)}
                      {disablePref ? ` (${t('No Active')})` : ''}
                    </>
                  ),
                },
                {
                  value: 'wallet_first',
                  label: getBillingPreferenceLabel('wallet_first', t),
                },
                {
                  value: 'subscription_only',
                  label: (
                    <>
                      {getBillingPreferenceLabel('subscription_only', t)}
                      {disablePref ? ` (${t('No Active')})` : ''}
                    </>
                  ),
                },
                {
                  value: 'wallet_only',
                  label: getBillingPreferenceLabel('wallet_only', t),
                },
              ]}
              value={displayPref}
              onValueChange={(v) => v !== null && handlePreferenceChange(v)}
            >
              <SelectTrigger className='h-8 w-[150px] text-xs'>
                <SelectValue>
                  {getBillingPreferenceLabel(displayPref, t)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value='subscription_first' disabled={disablePref}>
                    {getBillingPreferenceLabel('subscription_first', t)}
                    {disablePref ? ` (${t('No Active')})` : ''}
                  </SelectItem>
                  <SelectItem value='wallet_first'>
                    {getBillingPreferenceLabel('wallet_first', t)}
                  </SelectItem>
                  <SelectItem value='subscription_only' disabled={disablePref}>
                    {getBillingPreferenceLabel('subscription_only', t)}
                    {disablePref ? ` (${t('No Active')})` : ''}
                  </SelectItem>
                  <SelectItem value='wallet_only'>
                    {getBillingPreferenceLabel('wallet_only', t)}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8'
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')}
              />
            </Button>
          </div>
        </div>

        {disablePref && isSubPref && (
          <p className='text-muted-foreground text-xs'>
            {t(
              'Preference saved as {{pref}}, but no active subscription. Wallet will be used automatically.',
              {
                pref:
                  billingPreference === 'subscription_only'
                    ? t('Subscription Only')
                    : t('Subscription First'),
              }
            )}
          </p>
        )}

        {hasAny && (
          <>
            <Separator />
            <div className='grid max-h-[20rem] gap-2 overflow-y-auto pr-0.5 sm:grid-cols-2'>
              {allSubscriptions.map((sub) => {
                const subscription = sub.subscription
                const totalAmount = Number(subscription?.amount_total || 0)
                const usedAmount = Number(subscription?.amount_used || 0)
                const remainAmount =
                  totalAmount > 0 ? Math.max(0, totalAmount - usedAmount) : 0
                const planTitle =
                  planTitleMap.get(subscription?.plan_id) || ''
                const remainDays = getRemainingDays(sub)
                const usagePercent = getUsagePercent(sub)
                const now = Date.now() / 1000
                const isExpired = (subscription?.end_time || 0) < now
                const isCancelled = subscription?.status === 'cancelled'
                const isActive =
                  subscription?.status === 'active' && !isExpired

                return (
                  <div
                    key={subscription?.id}
                    className='bg-background rounded-md border p-3 text-xs'
                  >
                    <div className='flex items-center justify-between gap-2'>
                      <span className='min-w-0 truncate font-medium'>
                        {planTitle
                          ? `${planTitle} · #${subscription?.id}`
                          : `${t('Subscription')} #${subscription?.id}`}
                      </span>
                      {isActive ? (
                        <StatusBadge
                          label={t('Active')}
                          variant='success'
                          copyable={false}
                        />
                      ) : isCancelled ? (
                        <StatusBadge
                          label={t('Cancelled')}
                          variant='neutral'
                          copyable={false}
                        />
                      ) : (
                        <StatusBadge
                          label={t('Expired')}
                          variant='neutral'
                          copyable={false}
                        />
                      )}
                    </div>
                    <div className='text-muted-foreground mt-1.5 flex items-center justify-between gap-2'>
                      <span>
                        {isActive
                          ? t('Until')
                          : isCancelled
                            ? t('Cancelled at')
                            : t('Expired at')}{' '}
                        {new Date(
                          (subscription?.end_time || 0) * 1000
                        ).toLocaleString()}
                      </span>
                      {isActive && (
                        <span className='shrink-0'>
                          {t('{{count}} days remaining', {
                            count: remainDays,
                          })}
                        </span>
                      )}
                    </div>
                    {isActive && (subscription?.next_reset_time ?? 0) > 0 && (
                      <div className='text-muted-foreground mt-1'>
                        {t('Next reset')}:{' '}
                        {new Date(
                          subscription!.next_reset_time! * 1000
                        ).toLocaleString()}
                      </div>
                    )}
                    <div className='text-muted-foreground mt-1'>
                      {t('Total Quota')}:{' '}
                      {totalAmount > 0 ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={<span className='cursor-help' />}
                          >
                            {formatQuota(usedAmount)}/{formatQuota(totalAmount)}{' '}
                            · {t('Remaining')} {formatQuota(remainAmount)}
                          </TooltipTrigger>
                          <TooltipContent>
                            {t('Raw Quota')}: {usedAmount}/{totalAmount} ·{' '}
                            {t('Remaining')} {remainAmount}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        t('Unlimited')
                      )}
                      {totalAmount > 0 && (
                        <span className='ml-2'>
                          {t('Used')} {usagePercent}%
                        </span>
                      )}
                    </div>
                    {totalAmount > 0 && isActive && (
                      <Progress
                        value={usagePercent}
                        className='mt-2 h-1.5'
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
