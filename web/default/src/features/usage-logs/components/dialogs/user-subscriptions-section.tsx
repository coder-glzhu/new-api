import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Crown, Infinity as InfinityIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { formatQuota } from '@/lib/format'
import dayjs from '@/lib/dayjs'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { StatusBadge } from '@/components/status-badge'
import {
  getAdminPlans,
  getUserSubscriptions,
} from '@/features/subscriptions/api'
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'

interface UserSubscriptionsSectionProps {
  userId: number
  open: boolean
}

interface SubItemView {
  record: UserSubscriptionRecord
  planTitle: string
  isActive: boolean
  isCancelled: boolean
  isExpired: boolean
  remainingDays: number | null
}

function formatDate(ts?: number): string {
  if (!ts || ts <= 0) return '-'
  return dayjs(ts * 1000).format('YYYY-MM-DD')
}

export function UserSubscriptionsSection(props: UserSubscriptionsSectionProps) {
  const { t } = useTranslation()
  const [subs, setSubs] = useState<UserSubscriptionRecord[]>([])
  const [plans, setPlans] = useState<PlanRecord[]>([])
  // 参考时间戳（秒）。在数据加载完成时一次性记录，避免在渲染期间调用 Date.now() 触发
  // react-hooks/purity 规则。
  const [referenceNow, setReferenceNow] = useState(0)

  const fetchData = useCallback(async (id: number) => {
    try {
      const [subRes, planRes] = await Promise.all([
        getUserSubscriptions(id),
        getAdminPlans(),
      ])
      if (subRes.success) setSubs(subRes.data ?? [])
      if (planRes.success) setPlans(planRes.data ?? [])
      setReferenceNow(Math.floor(Date.now() / 1000))
    } catch {
      // 该弹窗仅 admin 可见，接口失败时不再额外 toast，避免与用户信息接口的 toast 重复
    }
  }, [])

  useEffect(() => {
    if (props.open && props.userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchData(props.userId)
    }
  }, [props.open, props.userId, fetchData])

  const planTitleMap = useMemo(() => {
    const map = new Map<number, string>()
    plans.forEach((p) => {
      if (p.plan?.id) map.set(p.plan.id, p.plan.title || `#${p.plan.id}`)
    })
    return map
  }, [plans])

  const items = useMemo<SubItemView[]>(() => {
    const now = referenceNow
    return subs.map((record) => {
      const sub = record.subscription
      const isCancelled = sub.status === 'cancelled'
      const isExpired =
        !isCancelled && sub.end_time > 0 && sub.end_time < now
      const isActive = sub.status === 'active' && !isExpired
      const remainingSeconds = sub.end_time > 0 ? sub.end_time - now : null
      const remainingDays =
        remainingSeconds !== null
          ? Math.max(0, Math.ceil(remainingSeconds / 86400))
          : null
      return {
        record,
        planTitle: planTitleMap.get(sub.plan_id) || `#${sub.plan_id}`,
        isCancelled,
        isExpired,
        isActive,
        remainingDays,
      }
    })
  }, [subs, planTitleMap, referenceNow])

  const sortedItems = useMemo<SubItemView[]>(() => {
    // active 在前；同状态按 end_time 倒序
    return [...items].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
      return (b.record.subscription.end_time || 0) -
        (a.record.subscription.end_time || 0)
    })
  }, [items])

  const activeCount = items.filter((i) => i.isActive).length

  // 加载中或确认无订阅时整体不渲染，避免没订阅的用户看到一瞬间的占位条
  if (sortedItems.length === 0) return null

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <Label className='text-muted-foreground flex items-center gap-1.5 text-xs'>
          <Crown className='size-3.5' />
          {t('Subscriptions')}
        </Label>
        <span className='text-muted-foreground text-xs'>
          {activeCount > 0
            ? t('{{count}} active', { count: activeCount })
            : t('None active')}
        </span>
      </div>
      <div className='space-y-2'>
        {sortedItems.map((item) => (
          <SubscriptionCard key={item.record.subscription.id} item={item} />
        ))}
      </div>
    </div>
  )
}

interface SubscriptionCardProps {
  item: SubItemView
}

function SubscriptionCard(props: SubscriptionCardProps) {
  const { t } = useTranslation()
  const sub = props.item.record.subscription
  const total = Number(sub.amount_total || 0)
  const used = Number(sub.amount_used || 0)
  const remainingQuota = Math.max(0, total - used)
  const usagePercent =
    total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const isUnlimited = total <= 0

  let statusBadge = (
    <StatusBadge label={t('Active')} variant='success' copyable={false} />
  )
  if (props.item.isCancelled) {
    statusBadge = (
      <StatusBadge label={t('Invalidated')} variant='neutral' copyable={false} />
    )
  } else if (props.item.isExpired) {
    statusBadge = (
      <StatusBadge label={t('Expired')} variant='neutral' copyable={false} />
    )
  }

  return (
    <div
      className={cn(
        'bg-muted/30 space-y-2.5 rounded-lg border p-3',
        !props.item.isActive && 'opacity-70'
      )}
    >
      <div className='flex items-center justify-between gap-2'>
        <div className='min-w-0 truncate text-sm font-semibold'>
          {props.item.planTitle}
        </div>
        {statusBadge}
      </div>

      {isUnlimited ? (
        <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
          <InfinityIcon className='size-3.5' />
          {t('Unlimited quota')}
        </div>
      ) : (
        <div className='space-y-1'>
          <Progress value={usagePercent} />
          <div className='text-muted-foreground flex items-center justify-between text-xs'>
            <span>
              {t('Used')} {formatQuota(used)} / {formatQuota(total)}
            </span>
            <span className='font-medium'>{usagePercent}%</span>
          </div>
          {props.item.isActive ? (
            <div className='text-muted-foreground text-xs'>
              {t('Remaining')} {formatQuota(remainingQuota)}
            </div>
          ) : null}
        </div>
      )}

      <div className='flex items-center justify-between gap-2 text-xs'>
        <span className='text-muted-foreground inline-flex items-center gap-1'>
          <CalendarClock className='size-3.5' />
          {formatDate(sub.start_time)}
          <span className='mx-0.5'>→</span>
          {formatDate(sub.end_time)}
        </span>
        {props.item.isActive && props.item.remainingDays !== null ? (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium',
              props.item.remainingDays <= 3
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            )}
          >
            {t('{{count}} days left', { count: props.item.remainingDays })}
          </span>
        ) : null}
      </div>

      {sub.next_reset_time && sub.next_reset_time > 0 && props.item.isActive ? (
        <div className='text-muted-foreground text-xs'>
          {t('Next reset')}: {formatDate(sub.next_reset_time)}
        </div>
      ) : null}
    </div>
  )
}
