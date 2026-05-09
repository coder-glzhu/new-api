import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Gift,
  Sparkles,
  Trophy,
  Users,
  Zap,
  Star,
  Clock,
  CheckCircle2,
  TrendingUp,
  CreditCard,
  MessageSquare,
  Calendar,
} from 'lucide-react'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { SectionPageLayout } from '@/components/layout'
import { getLuckyBagStatus, enterLuckyBag, getLuckyBagHistory } from './api'
import { useNextDrawCountdown } from './hooks'
import type { LuckyBagActivity, LuckyBagStatusResponse } from './types'

const DRAW_SLOTS = [
  { hour: 9, label: '09:00' },
  { hour: 12, label: '12:00' },
  { hour: 17, label: '17:00' },
]

function pad(n: number) {
  return n.toString().padStart(2, '0')
}

// ─── Countdown Block ──────────────────────────────────────────────────────────
function CountdownBlock({ value, label }: { value: number; label: string }) {
  return (
    <div className='flex flex-col items-center gap-1'>
      <div className='min-w-[3rem] rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-center backdrop-blur-sm'>
        <span className='text-2xl font-bold tabular-nums text-white leading-none'>
          {pad(value)}
        </span>
      </div>
      <span className='text-xs font-medium text-white/60'>{label}</span>
    </div>
  )
}

// ─── Today Slots Timeline ─────────────────────────────────────────────────────
function TodaySlotsTimeline({
  activities,
  nextHour,
}: {
  activities: LuckyBagActivity[]
  nextHour: number
}) {
  const { t } = useTranslation()
  const activityMap = new Map(activities.map((a) => [a.slot_hour, a]))

  return (
    <div className='flex items-stretch gap-0'>
      {DRAW_SLOTS.map((slot, idx) => {
        const activity = activityMap.get(slot.hour)
        const isDrawn = activity?.status === 'drawn'
        const isNext = slot.hour === nextHour
        const isPast = !isNext && !isDrawn && (() => {
          const now = new Date()
          return now.getHours() >= slot.hour
        })()

        return (
          <div key={slot.hour} className='flex flex-1 flex-col items-center gap-2'>
            {/* Connector line */}
            <div className='flex w-full items-center'>
              <div className={cn('h-px flex-1', idx === 0 ? 'bg-transparent' : isDrawn ? 'bg-yellow-400/50' : 'bg-white/20')} />
              <div className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-all',
                isDrawn
                  ? 'border-yellow-400 bg-yellow-400/20 text-yellow-300'
                  : isNext
                    ? 'border-white bg-white/20 text-white shadow-lg shadow-white/20 animate-pulse'
                    : isPast
                      ? 'border-white/30 bg-white/5 text-white/40'
                      : 'border-white/30 bg-white/5 text-white/40'
              )}>
                {isDrawn ? (
                  <Trophy className='size-3.5' />
                ) : isNext ? (
                  <Zap className='size-3.5' />
                ) : (
                  <Gift className='size-3.5' />
                )}
              </div>
              <div className={cn('h-px flex-1', idx === DRAW_SLOTS.length - 1 ? 'bg-transparent' : isDrawn ? 'bg-yellow-400/50' : 'bg-white/20')} />
            </div>

            {/* Label + status */}
            <div className='text-center'>
              <p className={cn('text-xs font-bold', isDrawn ? 'text-yellow-300' : isNext ? 'text-white' : 'text-white/50')}>
                {slot.label}
              </p>
              {isDrawn && activity?.winner_name ? (
                <p className='mt-0.5 text-[10px] text-yellow-300/80 truncate max-w-[5rem]'>
                  {activity.winner_name}
                </p>
              ) : isNext ? (
                <p className='mt-0.5 text-[10px] text-white/70'>{t('Next')}</p>
              ) : isPast ? (
                <p className='mt-0.5 text-[10px] text-white/40'>{t('No entries')}</p>
              ) : (
                <p className='mt-0.5 text-[10px] text-white/40'>{t('Upcoming')}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Hero Banner ──────────────────────────────────────────────────────────────
function HeroBanner({
  statusData,
  entered,
  participantCount,
  onEnter,
  entering,
}: {
  statusData: LuckyBagStatusResponse | null
  entered: boolean
  participantCount: number
  onEnter: () => void
  entering: boolean
}) {
  const { t } = useTranslation()
  const { hour: nextHour, h, m, s } = useNextDrawCountdown()
  const nextActivity = statusData?.next_activity
  const isNextDrawn = nextActivity?.status === 'drawn'
  const todayActivities = statusData?.today_activities ?? []

  return (
    <div className='relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 p-6 sm:p-8'>
      {/* Background decorations */}
      <div className='pointer-events-none absolute inset-0 overflow-hidden'>
        <div className='absolute -right-20 -top-20 size-64 rounded-full bg-white/5 blur-3xl' />
        <div className='absolute -bottom-16 -left-16 size-48 rounded-full bg-indigo-400/10 blur-2xl' />
        {[...Array(6)].map((_, i) => (
          <Star
            key={i}
            className='absolute text-white/10'
            style={{
              top: `${[15, 70, 30, 80, 10, 60][i]}%`,
              left: `${[10, 85, 50, 20, 75, 40][i]}%`,
              width: [8, 12, 6, 10, 7, 9][i],
              height: [8, 12, 6, 10, 7, 9][i],
            }}
          />
        ))}
      </div>

      <div className='relative z-10 flex flex-col gap-6'>
        {/* Top row: bag + title + countdown + button */}
        <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
          <div className='flex items-center gap-4'>
            <motion.div
              animate={{ rotate: [-4, 4, -4], y: [0, -4, 0] }}
              transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
              className='shrink-0'
            >
              <div className='relative flex size-16 items-center justify-center rounded-2xl border border-white/25 bg-white/15 shadow-xl backdrop-blur-sm'>
                <Gift className='size-8 text-white drop-shadow-lg' />
                <motion.div
                  animate={{ scale: [1, 1.4, 1], opacity: [0.7, 0, 0.7] }}
                  transition={{ repeat: Infinity, duration: 2, delay: 0.5 }}
                  className='absolute -right-1 -top-1 size-3 rounded-full bg-yellow-300'
                />
              </div>
            </motion.div>

            <div>
              <div className='flex items-center gap-2'>
                <Sparkles className='size-4 text-yellow-300' />
                <h1 className='text-xl font-bold text-white sm:text-2xl'>{t('Lucky Bag')}</h1>
              </div>
              <p className='mt-0.5 text-sm text-white/70'>{t('3 draws daily — 09:00 · 12:00 · 17:00')}</p>
              <div className='mt-1.5 flex items-center gap-2'>
                <Users className='size-3 text-white/60' />
                <span className='text-xs text-white/70'>
                  {participantCount} {t('Participants')}
                </span>
                {nextActivity && (
                  <>
                    <span className='text-white/30'>·</span>
                    <span className='text-xs text-white/70'>
                      {t('Prize')}: {formatQuota(nextActivity.min_quota)}–{formatQuota(nextActivity.max_quota)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className='flex flex-col items-start gap-3 sm:items-end'>
            <div>
              <p className='text-[10px] font-medium uppercase tracking-wider text-white/60 mb-1.5 sm:text-right'>
                {t('Next draw in')} ({pad(nextHour)}:00)
              </p>
              <div className='flex items-end gap-1.5'>
                <CountdownBlock value={h} label={t('Hours')} />
                <span className='mb-3 text-lg font-bold leading-none text-white/60'>:</span>
                <CountdownBlock value={m} label={t('Minutes')} />
                <span className='mb-3 text-lg font-bold leading-none text-white/60'>:</span>
                <CountdownBlock value={s} label={t('Seconds')} />
              </div>
            </div>

            <motion.div whileTap={{ scale: 0.95 }}>
              <Button
                onClick={onEnter}
                disabled={entered || entering || isNextDrawn}
                className={cn(
                  'h-10 rounded-xl px-6 font-semibold shadow-lg transition-all',
                  entered || isNextDrawn
                    ? 'cursor-default border border-white/30 bg-white/20 text-white/70 hover:bg-white/20'
                    : 'bg-white text-violet-700 hover:bg-white/90'
                )}
              >
                {entered ? (
                  <span className='flex items-center gap-1.5'>
                    <CheckCircle2 className='size-4' />
                    {t("You're In!")}
                  </span>
                ) : isNextDrawn ? (
                  t('Already drawn')
                ) : (
                  <span className='flex items-center gap-1.5'>
                    <Zap className='size-4' />
                    {t('Enter Lucky Bag Draw')}
                  </span>
                )}
              </Button>
            </motion.div>
          </div>
        </div>

        {/* Today slots timeline */}
        {todayActivities.length > 0 && (
          <div className='rounded-xl border border-white/15 bg-white/5 p-4'>
            <p className='mb-3 text-[10px] font-medium uppercase tracking-wider text-white/50'>
              {t("Today's Schedule")}
            </p>
            <TodaySlotsTimeline activities={todayActivities} nextHour={nextHour} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Weight Breakdown ─────────────────────────────────────────────────────────
function WeightBreakdownCard({ weight }: { weight: number }) {
  const { t } = useTranslation()

  const items = [
    {
      icon: CreditCard,
      label: t('From recharge'),
      desc: t('Every 500k quota = +1'),
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
    },
    {
      icon: MessageSquare,
      label: t('From requests'),
      desc: t('Every 100 requests = +1'),
      color: 'text-green-500',
      bg: 'bg-green-500/10',
    },
    {
      icon: Calendar,
      label: t('From check-ins'),
      desc: t('Up to 30 days = +30'),
      color: 'text-orange-500',
      bg: 'bg-orange-500/10',
    },
  ]

  return (
    <div className='bg-card ring-foreground/10 flex flex-col gap-4 rounded-xl p-5 ring-1'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <TrendingUp className='text-muted-foreground size-4' />
          <h3 className='text-sm font-semibold'>{t('Weight Breakdown')}</h3>
        </div>
        <div className='flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-1'>
          <Sparkles className='size-3 text-violet-500' />
          <span className='text-xs font-semibold text-violet-600 dark:text-violet-400'>
            {t('Weight')}: {weight}
          </span>
        </div>
      </div>

      <div className='space-y-3'>
        {items.map((item) => (
          <div key={item.label} className='flex items-start gap-3'>
            <div className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg', item.bg)}>
              <item.icon className={cn('size-3.5', item.color)} />
            </div>
            <div className='min-w-0 flex-1'>
              <span className='text-sm font-medium'>{item.label}</span>
              <p className='text-muted-foreground mt-0.5 text-xs'>{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <Separator />
      <div className='flex items-center justify-between text-xs'>
        <span className='text-muted-foreground'>{t('Your current weight')}</span>
        <span className='font-semibold'>{weight} pt</span>
      </div>
    </div>
  )
}

// ─── Rules Card ───────────────────────────────────────────────────────────────
function RulesCard() {
  const { t } = useTranslation()
  const rules = [
    t('3 draws per day — 09:00, 12:00, 17:00'),
    t('Enter each draw separately before the draw time'),
    t('One winner per draw via weighted random selection'),
    t('Higher recharge amount = more weight'),
    t('More API requests = more weight'),
    t('More check-in days = more weight (up to 30)'),
    t('Winners receive a redemption code in the draw history'),
  ]

  return (
    <div className='bg-card ring-foreground/10 flex flex-col gap-4 rounded-xl p-5 ring-1'>
      <div className='flex items-center gap-2'>
        <Star className='text-muted-foreground size-4' />
        <h3 className='text-sm font-semibold'>{t('Activity Rules')}</h3>
      </div>
      <ul className='space-y-2.5'>
        {rules.map((rule, i) => (
          <li key={i} className='flex items-start gap-2.5 text-xs text-muted-foreground'>
            <span className='mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-[10px] font-bold text-violet-600 dark:text-violet-400'>
              {i + 1}
            </span>
            {rule}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── History Table ────────────────────────────────────────────────────────────
function HistoryCard({
  activities,
  loading,
  total,
  page,
  onPageChange,
}: {
  activities: LuckyBagActivity[]
  loading: boolean
  total: number
  page: number
  onPageChange: (p: number) => void
}) {
  const { t } = useTranslation()
  const pageSize = 10
  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className='bg-card ring-foreground/10 flex flex-col gap-4 rounded-xl p-5 ring-1'>
      <div className='flex items-center gap-2'>
        <Clock className='text-muted-foreground size-4' />
        <h3 className='text-sm font-semibold'>{t('Draw History')}</h3>
        {total > 0 && (
          <span className='text-muted-foreground ml-auto text-xs'>{total} {t('records')}</span>
        )}
      </div>

      {loading ? (
        <div className='space-y-2'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-12 w-full rounded-lg' />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className='flex flex-col items-center justify-center py-10 text-center'>
          <Gift className='text-muted-foreground/30 mb-3 size-10' />
          <p className='text-muted-foreground text-sm'>{t('No history yet')}</p>
        </div>
      ) : (
        <div className='space-y-1.5'>
          {activities.map((a, idx) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.04 }}
              className={cn(
                'flex items-center justify-between rounded-lg px-3.5 py-2.5 text-sm transition-colors',
                idx === 0 && page === 1
                  ? 'border border-yellow-200/50 bg-gradient-to-r from-yellow-50 to-amber-50 dark:border-yellow-800/30 dark:from-yellow-950/20 dark:to-amber-950/20'
                  : 'bg-muted/30 hover:bg-muted/50'
              )}
            >
              <div className='flex min-w-0 items-center gap-2.5'>
                {idx === 0 && page === 1 ? (
                  <Trophy className='size-3.5 shrink-0 text-yellow-500' />
                ) : (
                  <Gift className='size-3.5 shrink-0 text-muted-foreground/50' />
                )}
                <div className='min-w-0'>
                  <span className='font-medium'>{a.winner_name || t('Anonymous')}</span>
                  <span className='text-muted-foreground ml-2 text-xs'>
                    {a.draw_date} {pad(a.slot_hour)}:00
                  </span>
                </div>
              </div>
              <span className={cn(
                'ml-2 shrink-0 text-xs font-semibold',
                idx === 0 && page === 1 ? 'text-yellow-700 dark:text-yellow-400' : 'text-foreground'
              )}>
                {formatQuota(a.winner_quota)}
              </span>
            </motion.div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className='flex items-center justify-center gap-1.5 pt-1'>
          <Button
            variant='outline'
            size='sm'
            className='h-7 px-2.5 text-xs'
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {t('Prev')}
          </Button>
          <span className='text-muted-foreground px-1 text-xs'>
            {page} / {totalPages}
          </span>
          <Button
            variant='outline'
            size='sm'
            className='h-7 px-2.5 text-xs'
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function LuckyBag() {
  const { t } = useTranslation()

  const [statusData, setStatusData] = useState<LuckyBagStatusResponse | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [entered, setEntered] = useState(false)
  const [entering, setEntering] = useState(false)
  const [weight, setWeight] = useState(1)

  const [historyActivities, setHistoryActivities] = useState<LuckyBagActivity[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyLoading, setHistoryLoading] = useState(true)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await getLuckyBagStatus()
      if (res.success && res.data) {
        setStatusData(res.data)
        setEntered(res.data.entered)
        setWeight(res.data.weight || 1)
      }
    } catch {
      // ignore
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const fetchHistory = useCallback(async (page: number) => {
    setHistoryLoading(true)
    try {
      const res = await getLuckyBagHistory(page, 10)
      if (res.success && res.data) {
        setHistoryActivities(res.data.activities || [])
        setHistoryTotal(res.data.total || 0)
      }
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchHistory(1)
  }, [fetchStatus, fetchHistory])

  const handleEnter = async () => {
    if (entering || entered) return
    setEntering(true)
    try {
      const res = await enterLuckyBag()
      if (res.success) {
        setEntered(true)
        toast.success(t('Successfully entered the draw!'))
        fetchStatus()
      } else {
        toast.error(res.message || t('Failed to enter'))
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setEntering(false)
    }
  }

  const handlePageChange = (page: number) => {
    setHistoryPage(page)
    fetchHistory(page)
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Lucky Bag')}</SectionPageLayout.Title>
      <SectionPageLayout.Description>
        {t('Win a free redemption code every day via weighted random draw')}
      </SectionPageLayout.Description>
      <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-4xl flex-col gap-5'>
          {statusLoading ? (
            <Skeleton className='h-64 w-full rounded-2xl' />
          ) : (
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <HeroBanner
                  statusData={statusData}
                  entered={entered}
                  participantCount={statusData?.participant_count ?? 0}
                  onEnter={handleEnter}
                  entering={entering}
                />
              </motion.div>
            </AnimatePresence>
          )}

          <div className='grid grid-cols-1 gap-5 lg:grid-cols-2'>
            <WeightBreakdownCard weight={weight} />
            <RulesCard />
          </div>

          <HistoryCard
            activities={historyActivities}
            loading={historyLoading}
            total={historyTotal}
            page={historyPage}
            onPageChange={handlePageChange}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
