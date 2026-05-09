import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, RefreshCw, Wallet as WalletIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
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
  updateSubscriptionPriorities,
} from '@/features/subscriptions/api'
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'

type BillingPreference = 'subscription_first' | 'wallet_first' | 'subscription_only' | 'wallet_only'

const BILLING_PREF_OPTIONS: { value: BillingPreference; labelKey: string; descKey: string }[] = [
  { value: 'subscription_first', labelKey: 'Subscription First', descKey: 'Deduct from subscription first, then wallet' },
  { value: 'wallet_first', labelKey: 'Wallet First', descKey: 'Deduct from wallet first, then subscription' },
  { value: 'subscription_only', labelKey: 'Subscription Only', descKey: 'Only deduct from subscription' },
  { value: 'wallet_only', labelKey: 'Wallet Only', descKey: 'Only deduct from wallet' },
]

interface MySubscriptionsCardProps {
  onAvailabilityChange?: (available: boolean) => void
}

// A single draggable subscription row
function SortableSubscriptionItem({
  record,
  planTitle,
  isActive,
  isCancelled,
  remainDays,
  usagePercent,
  totalAmount,
  usedAmount,
  remainAmount,
  isDragging,
  t,
}: {
  record: UserSubscriptionRecord
  planTitle: string
  isActive: boolean
  isCancelled: boolean
  remainDays: number
  usagePercent: number
  totalAmount: number
  usedAmount: number
  remainAmount: number
  isDragging: boolean
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const subscription = record.subscription
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: sortableIsDragging,
  } = useSortable({ id: subscription?.id ?? 0, disabled: !isActive })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: sortableIsDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-muted/30 rounded-lg border p-3.5 text-xs',
        sortableIsDragging && 'shadow-lg'
      )}
    >
      <div className='flex items-start gap-2'>
        {/* Drag handle — only for active subscriptions */}
        {isActive ? (
          <button
            className='text-muted-foreground/40 hover:text-muted-foreground mt-0.5 cursor-grab touch-none active:cursor-grabbing'
            {...attributes}
            {...listeners}
            tabIndex={-1}
            aria-label={t('Drag to reorder')}
          >
            <GripVertical className='size-4 shrink-0' />
          </button>
        ) : (
          <div className='size-4 shrink-0' />
        )}

        <div className='min-w-0 flex-1 space-y-2'>
          <div className='flex items-start justify-between gap-2'>
            <span className='min-w-0 truncate text-sm font-medium'>
              {planTitle
                ? `${planTitle} · #${subscription?.id}`
                : `${t('Subscription')} #${subscription?.id}`}
            </span>
            {isActive ? (
              <StatusBadge label={t('Active')} variant='success' copyable={false} />
            ) : isCancelled ? (
              <StatusBadge label={t('Cancelled')} variant='neutral' copyable={false} />
            ) : (
              <StatusBadge label={t('Expired')} variant='neutral' copyable={false} />
            )}
          </div>

          <div className='text-muted-foreground space-y-1'>
            <div className='flex items-center justify-between'>
              <span>
                {isActive
                  ? t('Until')
                  : isCancelled
                    ? t('Cancelled at')
                    : t('Expired at')}{' '}
                {new Date((subscription?.end_time || 0) * 1000).toLocaleString()}
              </span>
              {isActive && (
                <span className='shrink-0 font-medium text-foreground'>
                  {t('{{count}} days remaining', { count: remainDays })}
                </span>
              )}
            </div>

            {isActive && (subscription?.next_reset_time ?? 0) > 0 && (
              <div>
                {t('Next reset')}:{' '}
                {new Date(subscription!.next_reset_time! * 1000).toLocaleString()}
              </div>
            )}

            <div>
              {t('Total Quota')}:{' '}
              {totalAmount > 0 ? (
                <Tooltip>
                  <TooltipTrigger render={<span className='cursor-help' />}>
                    {formatQuota(usedAmount)}/{formatQuota(totalAmount)} ·{' '}
                    {t('Remaining')} {formatQuota(remainAmount)}
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('Raw Quota')}: {usedAmount}/{totalAmount} · {t('Remaining')}{' '}
                    {remainAmount}
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
          </div>

          {totalAmount > 0 && isActive && (
            <Progress value={usagePercent} className='h-1.5' />
          )}
        </div>
      </div>
    </div>
  )
}

export function MySubscriptionsCard({ onAvailabilityChange }: MySubscriptionsCardProps) {
  const { t } = useTranslation()

  const [allSubscriptions, setAllSubscriptions] = useState<UserSubscriptionRecord[]>([])
  const [activeSubscriptions, setActiveSubscriptions] = useState<UserSubscriptionRecord[]>([])
  // Ordered list of active subscription IDs (reflects drag order)
  const [activeOrder, setActiveOrder] = useState<number[]>([])
  const [billingPref, setBillingPref] = useState<BillingPreference>('subscription_first')
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingPref, setSavingPref] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // Track whether the order was actually changed to avoid unnecessary API calls
  const initialOrderRef = useRef<number[]>([])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const fetchData = useCallback(async () => {
    try {
      const [subRes, planRes] = await Promise.all([
        getSelfSubscriptionFull(),
        getPublicPlans(),
      ])
      if (subRes.success && subRes.data) {
        const active = subRes.data.subscriptions || []
        const all = subRes.data.all_subscriptions || []
        setActiveSubscriptions(active)
        setAllSubscriptions(all)
        setBillingPref((subRes.data.billing_preference as BillingPreference) || 'subscription_first')

        // Build ordered IDs: sort active by user_priority desc, then id asc
        const ordered = [...active]
          .sort((a, b) => {
            const pa = a.subscription?.user_priority ?? 0
            const pb = b.subscription?.user_priority ?? 0
            if (pb !== pa) return pb - pa
            return (a.subscription?.id ?? 0) - (b.subscription?.id ?? 0)
          })
          .map((r) => r.subscription?.id ?? 0)
          .filter(Boolean)

        setActiveOrder(ordered)
        initialOrderRef.current = ordered
      }
      if (planRes.success) setPlans(planRes.data || [])
    } catch {
      // ignore
    }
  }, [])

  const handleBillingPrefChange = async (pref: BillingPreference) => {
    setBillingPref(pref)
    setSavingPref(true)
    try {
      const res = await updateBillingPreference(pref)
      if (!res.success) {
        toast.error(res.message || t('Update failed'))
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setSavingPref(false)
    }
  }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await fetchData()
      setLoading(false)
    }
    init()
  }, [fetchData])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchData()
    } finally {
      setRefreshing(false)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setIsDragging(false)
    const { active, over } = event
    if (!over || active.id === over.id) return

    setActiveOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as number)
      const newIndex = prev.indexOf(over.id as number)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  // Save priority when order changes (debounced via useEffect)
  useEffect(() => {
    if (loading || refreshing) return
    // No change
    if (activeOrder.length === 0) return
    const unchanged =
      activeOrder.length === initialOrderRef.current.length &&
      activeOrder.every((id, i) => id === initialOrderRef.current[i])
    if (unchanged) return

    const items = activeOrder.map((id, index) => ({
      id,
      priority: activeOrder.length - index, // highest index = lowest priority number
    }))

    setSaving(true)
    updateSubscriptionPriorities(items)
      .then((res) => {
        if (res.success) {
          initialOrderRef.current = activeOrder
          toast.success(t('Priority updated'))
        } else {
          toast.error(res.message || t('Update failed'))
        }
      })
      .catch(() => toast.error(t('Request failed')))
      .finally(() => setSaving(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder])

  const planTitleMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const p of plans) {
      if (p?.plan?.id) map.set(p.plan.id, p.plan.title || '')
    }
    return map
  }, [plans])

  const hasActive = activeSubscriptions.length > 0
  const hasAny = allSubscriptions.length > 0

  useEffect(() => {
    onAvailabilityChange?.(hasAny)
  }, [hasAny, onAvailabilityChange])

  // Build a merged list: active (in drag order) + inactive
  const orderedActive = useMemo(() => {
    const map = new Map(
      activeSubscriptions.map((r) => [r.subscription?.id ?? 0, r])
    )
    return activeOrder.map((id) => map.get(id)).filter(Boolean) as UserSubscriptionRecord[]
  }, [activeSubscriptions, activeOrder])

  const inactiveSubscriptions = useMemo(() => {
    const activeIds = new Set(activeSubscriptions.map((r) => r.subscription?.id))
    return allSubscriptions.filter((r) => !activeIds.has(r.subscription?.id))
  }, [allSubscriptions, activeSubscriptions])

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
      <div className='bg-card ring-foreground/10 flex flex-col gap-4 rounded-xl p-5 ring-1'>
        <div className='flex items-center justify-between'>
          <Skeleton className='h-5 w-32' />
          <Skeleton className='h-8 w-8 rounded-lg' />
        </div>
        <div className='space-y-3'>
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className='h-24 w-full rounded-lg' />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className='bg-card ring-foreground/10 flex flex-col gap-4 rounded-xl p-5 ring-1'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <div className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg'>
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
              {inactiveSubscriptions.length > 0 && (
                <>
                  <span className='text-muted-foreground/30'>·</span>
                  <span className='text-muted-foreground'>
                    {inactiveSubscriptions.length} {t('expired')}
                  </span>
                </>
              )}
            </span>
            {(saving || savingPref) && (
              <span className='text-muted-foreground text-xs'>
                {t('Saving...')}
              </span>
            )}
          </div>
          {hasActive && activeOrder.length > 1 && (
            <p className='text-muted-foreground mt-0.5 text-xs'>
              {t('Drag to set deduction order — top subscription is charged first')}
            </p>
          )}
        </div>
        <Button
          variant='ghost'
          size='icon'
          className='h-8 w-8 shrink-0'
          onClick={handleRefresh}
          disabled={refreshing || saving}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
      </div>

      {/* Billing preference selector */}
      <div className='space-y-1.5'>
        <p className='text-muted-foreground text-xs font-medium'>{t('Deduction Mode')}</p>
        <div className='grid grid-cols-2 gap-1.5'>
          {BILLING_PREF_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              disabled={savingPref}
              onClick={() => handleBillingPrefChange(opt.value)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                billingPref === opt.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/30 text-muted-foreground hover:bg-muted/60 border-transparent'
              )}
            >
              <span className='block font-medium'>{t(opt.labelKey)}</span>
              <span className={cn('block mt-0.5', billingPref === opt.value ? 'text-primary-foreground/70' : 'text-muted-foreground/70')}>
                {t(opt.descKey)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Subscription list */}
      {hasAny ? (
        <div className='space-y-2'>
          {/* Active subscriptions — draggable */}
          {orderedActive.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={() => setIsDragging(true)}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setIsDragging(false)}
            >
              <SortableContext
                items={activeOrder}
                strategy={verticalListSortingStrategy}
              >
                <div className='space-y-2'>
                  {orderedActive.map((record) => {
                    const subscription = record.subscription
                    const totalAmount = Number(subscription?.amount_total || 0)
                    const usedAmount = Number(subscription?.amount_used || 0)
                    const remainAmount =
                      totalAmount > 0 ? Math.max(0, totalAmount - usedAmount) : 0
                    const planTitle = planTitleMap.get(subscription?.plan_id ?? 0) || ''
                    const remainDays = getRemainingDays(record)
                    const usagePercent = getUsagePercent(record)

                    return (
                      <SortableSubscriptionItem
                        key={subscription?.id}
                        record={record}
                        planTitle={planTitle}
                        isActive={true}
                        isCancelled={false}
                        remainDays={remainDays}
                        usagePercent={usagePercent}
                        totalAmount={totalAmount}
                        usedAmount={usedAmount}
                        remainAmount={remainAmount}
                        isDragging={isDragging}
                        t={t}
                      />
                    )
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* Inactive subscriptions — static */}
          {inactiveSubscriptions.map((record) => {
            const subscription = record.subscription
            const totalAmount = Number(subscription?.amount_total || 0)
            const usedAmount = Number(subscription?.amount_used || 0)
            const remainAmount =
              totalAmount > 0 ? Math.max(0, totalAmount - usedAmount) : 0
            const planTitle = planTitleMap.get(subscription?.plan_id ?? 0) || ''
            const remainDays = getRemainingDays(record)
            const usagePercent = getUsagePercent(record)
            const now = Date.now() / 1000
            const isExpired = (subscription?.end_time || 0) < now
            const isCancelled = subscription?.status === 'cancelled'
            const isActive = subscription?.status === 'active' && !isExpired

            return (
              <SortableSubscriptionItem
                key={subscription?.id}
                record={record}
                planTitle={planTitle}
                isActive={isActive}
                isCancelled={isCancelled}
                remainDays={remainDays}
                usagePercent={usagePercent}
                totalAmount={totalAmount}
                usedAmount={usedAmount}
                remainAmount={remainAmount}
                isDragging={false}
                t={t}
              />
            )
          })}
        </div>
      ) : (
        <div className='flex flex-col items-center justify-center py-12 text-center'>
          <WalletIcon className='text-muted-foreground/30 mb-3 size-10' />
          <p className='text-muted-foreground text-sm'>
            {t('No subscription records')}
          </p>
          <p className='text-muted-foreground/60 mt-1 text-xs'>
            {t('Purchase a plan below to get started')}
          </p>
        </div>
      )}
    </div>
  )
}
