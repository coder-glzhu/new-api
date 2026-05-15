import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  CalendarClock,
  CreditCard,
  GripVertical,
  Layers,
  RefreshCw,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import { StatusBadge } from '@/components/status-badge'
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

type BillingPreference =
  | 'subscription_first'
  | 'wallet_first'
  | 'subscription_only'
  | 'wallet_only'

const BILLING_PREFS: BillingPreference[] = [
  'subscription_first',
  'wallet_first',
  'subscription_only',
  'wallet_only',
]

function prefLabel(pref: BillingPreference, t: (key: string) => string) {
  switch (pref) {
    case 'subscription_first':
      return t('Subscription First')
    case 'wallet_first':
      return t('Wallet First')
    case 'subscription_only':
      return t('Subscription Only')
    case 'wallet_only':
      return t('Wallet Only')
  }
}

function SubscriptionRow({
  record,
  planTitle,
  draggable,
  nowSec,
}: {
  record: UserSubscriptionRecord
  planTitle: string
  draggable: boolean
  nowSec: number
}) {
  const { t } = useTranslation()
  const subscription = record.subscription
  const id = subscription?.id ?? 0
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !draggable })
  const now = nowSec
  const isExpired = (subscription.end_time || 0) < now
  const isCancelled = subscription.status === 'cancelled'
  const isActive = subscription.status === 'active' && !isExpired
  const totalAmount = Number(subscription.amount_total || 0)
  const usedAmount = Number(subscription.amount_used || 0)
  const remainingAmount =
    totalAmount > 0 ? Math.max(0, totalAmount - usedAmount) : 0
  const usagePercent =
    totalAmount > 0 ? Math.round((usedAmount / totalAmount) * 100) : 0
  const remainingDays = Math.max(
    0,
    Math.ceil(((subscription.end_time || 0) - now) / 86400)
  )

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'group bg-background relative rounded-lg border transition-shadow',
        isActive && 'border-border',
        !isActive && 'border-dashed opacity-70',
        isDragging && 'z-10 shadow-lg ring-1 ring-primary/40'
      )}
    >
      <div className='flex items-stretch'>
        {draggable ? (
          <button
            type='button'
            className='text-muted-foreground/60 hover:bg-muted/50 hover:text-muted-foreground flex w-8 shrink-0 cursor-grab items-center justify-center rounded-l-lg touch-none active:cursor-grabbing'
            aria-label={t('Drag to reorder')}
            {...attributes}
            {...listeners}
          >
            <GripVertical className='size-4' />
          </button>
        ) : (
          <div
            className={cn(
              'flex w-8 shrink-0 items-center justify-center',
              !isActive && 'text-muted-foreground/40'
            )}
          />
        )}

        <div className='min-w-0 flex-1 px-3 py-2.5 sm:px-3.5 sm:py-3'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div className='flex min-w-0 items-center gap-2'>
              <span className='truncate text-sm font-semibold'>
                {planTitle || t('Subscription')}
              </span>
              <span className='text-muted-foreground/70 text-xs tabular-nums'>
                #{id}
              </span>
            </div>
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

          <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
            <span className='text-muted-foreground inline-flex items-center gap-1'>
              <CalendarClock className='size-3.5' />
              {isActive
                ? t('Until')
                : isCancelled
                  ? t('Cancelled at')
                  : t('Expired at')}{' '}
              <span className='text-foreground/80'>
                {new Date(subscription.end_time * 1000).toLocaleDateString()}
              </span>
            </span>
            {isActive ? (
              <span className='text-foreground/90 font-medium tabular-nums'>
                {t('{{count}} days remaining', { count: remainingDays })}
              </span>
            ) : null}
          </div>

          {totalAmount > 0 ? (
            <div className='mt-2.5'>
              <div className='text-muted-foreground/80 mb-1 flex items-center justify-between text-[11px]'>
                <span className='inline-flex items-center gap-1'>
                  <CreditCard className='size-3' />
                  {formatQuota(usedAmount)} / {formatQuota(totalAmount)}
                </span>
                <span className='tabular-nums'>{usagePercent}%</span>
              </div>
              <Progress value={usagePercent} className='h-1.5' />
              {isActive ? (
                <div className='text-muted-foreground/60 mt-1 text-[11px]'>
                  {t('Remaining')} {formatQuota(remainingAmount)}
                </div>
              ) : null}
            </div>
          ) : (
            <div className='text-muted-foreground/70 mt-2 inline-flex items-center gap-1 text-xs'>
              <Layers className='size-3' />
              {t('Unlimited')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface MySubscriptionsCardProps {
  refreshSignal?: number
}

export function MySubscriptionsCard({
  refreshSignal,
}: MySubscriptionsCardProps = {}) {
  const { t } = useTranslation()
  const [allSubscriptions, setAllSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [activeSubscriptions, setActiveSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [activeOrder, setActiveOrder] = useState<number[]>([])
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [billingPref, setBillingPref] =
    useState<BillingPreference>('subscription_first')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  const initialOrderRef = useRef<number[]>([])

  useEffect(() => {
    const id = window.setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      60_000
    )
    return () => window.clearInterval(id)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const fetchData = useCallback(async () => {
    const [subRes, planRes] = await Promise.all([
      getSelfSubscriptionFull(),
      getPublicPlans(),
    ])
    if (subRes.success && subRes.data) {
      const active = subRes.data.subscriptions || []
      const all = subRes.data.all_subscriptions || []
      const order = [...active]
        .sort((a, b) => {
          const pa = a.subscription.user_priority ?? 0
          const pb = b.subscription.user_priority ?? 0
          if (pb !== pa) return pb - pa
          return a.subscription.id - b.subscription.id
        })
        .map((item) => item.subscription.id)
      setActiveSubscriptions(active)
      setAllSubscriptions(all)
      setActiveOrder(order)
      initialOrderRef.current = order
      setBillingPref(
        (subRes.data.billing_preference as BillingPreference) ||
          'subscription_first'
      )
    }
    if (planRes.success) setPlans(planRes.data || [])
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        await fetchData()
      } finally {
        setLoading(false)
      }
    }
    void init()
  }, [fetchData])

  useEffect(() => {
    if (refreshSignal === undefined || refreshSignal === 0) return
    void fetchData()
  }, [refreshSignal, fetchData])

  const planTitleMap = useMemo(() => {
    return new Map(plans.map((item) => [item.plan.id, item.plan.title]))
  }, [plans])

  const orderedActive = useMemo(() => {
    const map = new Map(
      activeSubscriptions.map((item) => [item.subscription.id, item])
    )
    return activeOrder
      .map((id) => map.get(id))
      .filter(Boolean) as UserSubscriptionRecord[]
  }, [activeOrder, activeSubscriptions])

  const inactive = useMemo(() => {
    const activeIds = new Set(
      activeSubscriptions.map((item) => item.subscription.id)
    )
    return allSubscriptions.filter(
      (item) => !activeIds.has(item.subscription.id)
    )
  }, [activeSubscriptions, allSubscriptions])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchData()
    } finally {
      setRefreshing(false)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setActiveOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as number)
      const newIndex = prev.indexOf(over.id as number)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  useEffect(() => {
    if (loading || activeOrder.length === 0) return
    const unchanged =
      activeOrder.length === initialOrderRef.current.length &&
      activeOrder.every((id, index) => id === initialOrderRef.current[index])
    if (unchanged) return

    const items = activeOrder.map((id, index) => ({
      id,
      priority: activeOrder.length - index,
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
  }, [activeOrder, loading, t])

  const handlePrefChange = async (pref: BillingPreference) => {
    const previous = billingPref
    setBillingPref(pref)
    const res = await updateBillingPreference(pref)
    if (res.success) {
      toast.success(t('Updated successfully'))
    } else {
      setBillingPref(previous)
      toast.error(res.message || t('Update failed'))
    }
  }

  const activeCount = activeSubscriptions.length
  const inactiveCount = inactive.length
  const draggable = activeOrder.length > 1
  const hasActive = activeCount > 0
  const isSubPref =
    billingPref === 'subscription_first' || billingPref === 'subscription_only'
  const displayPref = !hasActive && isSubPref ? 'wallet_first' : billingPref

  if (loading) {
    return (
      <TitledCard
        title={t('My Subscriptions')}
        icon={<Layers className='h-4 w-4' />}
      >
        <div className='space-y-3'>
          <Skeleton className='h-9 w-full' />
          <Skeleton className='h-24 w-full' />
          <Skeleton className='h-24 w-full' />
        </div>
      </TitledCard>
    )
  }

  return (
    <TitledCard
      title={t('My Subscriptions')}
      description={
        draggable
          ? t('Drag subscriptions to set deduction order')
          : t('Active and historical subscriptions')
      }
      icon={<Layers className='h-4 w-4' />}
      action={
        <Button
          variant='ghost'
          size='icon'
          className='h-8 w-8'
          onClick={handleRefresh}
          disabled={refreshing || saving}
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
        </Button>
      }
      contentClassName='space-y-3.5'
    >
      <div className='bg-muted/30 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2'>
        <div className='flex flex-wrap items-center gap-2 text-xs'>
          {activeCount > 0 ? (
            <StatusBadge
              copyable={false}
              variant='success'
              label={`${activeCount} ${t('active')}`}
            />
          ) : (
            <StatusBadge
              copyable={false}
              variant='neutral'
              label={t('No Active')}
            />
          )}
          {inactiveCount > 0 ? (
            <span className='text-muted-foreground'>
              · {inactiveCount} {t('expired')}
            </span>
          ) : null}
        </div>
        <div className='flex w-full items-center gap-1.5 sm:w-auto'>
          <span className='text-muted-foreground hidden text-xs sm:inline'>
            {t('Deduction Mode')}
          </span>
          <Select
            items={BILLING_PREFS.map((pref) => ({
              value: pref,
              label: prefLabel(pref, t),
            }))}
            value={displayPref}
            onValueChange={(value) =>
              value !== null && void handlePrefChange(value as BillingPreference)
            }
          >
            <SelectTrigger className='h-8 flex-1 text-xs sm:w-[150px] sm:flex-none'>
              <SelectValue>{prefLabel(displayPref, t)}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {BILLING_PREFS.map((pref) => {
                  const disabled =
                    !hasActive &&
                    (pref === 'subscription_first' ||
                      pref === 'subscription_only')
                  return (
                    <SelectItem key={pref} value={pref} disabled={disabled}>
                      {prefLabel(pref, t)}
                      {disabled ? ` (${t('No Active')})` : ''}
                    </SelectItem>
                  )
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {allSubscriptions.length > 0 ? (
        <div className='space-y-2'>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={activeOrder}
              strategy={verticalListSortingStrategy}
            >
              {orderedActive.map((record) => (
                <SubscriptionRow
                  key={record.subscription.id}
                  record={record}
                  planTitle={
                    planTitleMap.get(record.subscription.plan_id) || ''
                  }
                  draggable={draggable}
                  nowSec={nowSec}
                />
              ))}
            </SortableContext>
          </DndContext>
          {inactive.map((record) => (
            <SubscriptionRow
              key={record.subscription.id}
              record={record}
              planTitle={planTitleMap.get(record.subscription.plan_id) || ''}
              draggable={false}
              nowSec={nowSec}
            />
          ))}
        </div>
      ) : (
        <div className='text-muted-foreground rounded-lg border border-dashed py-10 text-center text-sm'>
          {t('No subscription records')}
        </div>
      )}
    </TitledCard>
  )
}
