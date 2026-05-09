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
  Copy,
  Check,
  HeartCrack,
  X,
} from 'lucide-react'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionPageLayout } from '@/components/layout'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { getLuckyBagStatus, enterLuckyBag, getLuckyBagHistory, markLuckyBagViewed } from './api'
import { useNextDrawCountdown } from './hooks'
import type { LuckyBagActivity, LuckyBagResultCard, LuckyBagStatusResponse } from './types'

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
  nextMinute,
}: {
  activities: LuckyBagActivity[]
  nextHour: number
  nextMinute: number
}) {
  const { t } = useTranslation()
  const slots = [...activities]
    .sort((a, b) => (a.slot_hour - b.slot_hour) || (a.slot_minute - b.slot_minute))
    .map((a) => ({
      hour: a.slot_hour,
      minute: a.slot_minute,
      label: `${pad(a.slot_hour)}:${pad(a.slot_minute)}`,
    }))

  return (
    <div className='flex items-stretch gap-0'>
      {slots.map((slot, idx) => {
        const activity = activities.find(
          (a) => a.slot_hour === slot.hour && a.slot_minute === slot.minute
        )
        const isDrawn = activity?.status === 'drawn'
        const slotKey = slot.hour * 60 + slot.minute
        const now = new Date()
        const nowKey = now.getHours() * 60 + now.getMinutes()
        const isPastTime = nowKey >= slotKey
        // 下一场：匹配倒计时指向的场次，且未开奖、未过时
        const isNext =
          !isDrawn &&
          !isPastTime &&
          slot.hour === nextHour &&
          slot.minute === nextMinute
        // 过期但还未开奖：管理员刚配置的历史时间点，等待 task 补开奖
        const isAwaitingDraw = !isDrawn && isPastTime

        return (
          <div key={`${slot.hour}-${slot.minute}`} className='flex flex-1 flex-col items-center gap-2'>
            {/* Connector line */}
            <div className='flex w-full items-center'>
              <div className={cn('h-px flex-1', idx === 0 ? 'bg-transparent' : isDrawn ? 'bg-yellow-400/50' : 'bg-white/20')} />
              <div className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-all',
                isDrawn
                  ? 'border-yellow-400 bg-yellow-400/20 text-yellow-300'
                  : isNext
                    ? 'border-white bg-white/20 text-white shadow-lg shadow-white/20 animate-pulse'
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
              <div className={cn('h-px flex-1', idx === slots.length - 1 ? 'bg-transparent' : isDrawn ? 'bg-yellow-400/50' : 'bg-white/20')} />
            </div>

            {/* Label + status */}
            <div className='text-center'>
              <p className={cn('text-xs font-bold', isDrawn ? 'text-yellow-300' : isNext ? 'text-white' : 'text-white/50')}>
                {slot.label}
              </p>
              {isDrawn ? (
                activity?.winner_name ? (
                  <p className='mt-0.5 text-[10px] text-yellow-300/80 truncate max-w-[5rem]'>
                    {activity.winner_name}
                  </p>
                ) : (
                  <p className='mt-0.5 text-[10px] text-yellow-300/60'>{t('No entries')}</p>
                )
              ) : isNext ? (
                <p className='mt-0.5 text-[10px] text-white/70'>{t('Next')}</p>
              ) : isAwaitingDraw ? (
                <p className='mt-0.5 text-[10px] text-white/50'>{t('Drawing...')}</p>
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
  onDrawTime,
}: {
  statusData: LuckyBagStatusResponse | null
  entered: boolean
  participantCount: number
  onEnter: () => void
  entering: boolean
  onDrawTime: () => void
}) {
  const { t } = useTranslation()
  const { hour: nextHour, minute: nextMinute, h, m, s } = useNextDrawCountdown(statusData?.draw_slots, onDrawTime)
  const nextActivity = statusData?.next_activity
  const isNextDrawn = nextActivity?.status === 'drawn'
  const nextLocked = statusData?.next_locked ?? false
  const todayActivities = statusData?.today_activities ?? []
  const todayFinished = statusData?.today_finished ?? false
  // 下一场是否是"明天"，用于判断是否显示"今日已结束"状态
  const today = new Date().toISOString().slice(0, 10)
  const nextIsTomorrow = !!nextActivity && nextActivity.draw_date > today

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
              <p className='mt-0.5 text-sm text-white/70'>
                {(() => {
                  const slots = statusData?.draw_slots ?? [
                    { hour: 9, minute: 0 },
                    { hour: 12, minute: 0 },
                    { hour: 17, minute: 0 },
                  ]
                  return t('{{count}} draws daily — {{slots}}', {
                    count: slots.length,
                    slots: slots.map((sl) => `${pad(sl.hour)}:${pad(sl.minute)}`).join(' · '),
                  })
                })()}
              </p>
              <div className='mt-1.5 flex items-center gap-2'>
                <Users className='size-3 text-white/60' />
                <span className='text-xs text-white/70'>
                  {participantCount} {t('Participants')}
                </span>
              </div>
            </div>
          </div>

          <div className='flex flex-col items-start gap-3 sm:items-end'>
            <div>
              <p className='text-[10px] font-medium uppercase tracking-wider text-white/60 mb-1.5 sm:text-right'>
                {todayFinished
                  ? t('Next draw: Tomorrow {{slot}}', { slot: `${pad(nextHour)}:${pad(nextMinute)}` })
                  : `${t('Next draw in')} (${pad(nextHour)}:${pad(nextMinute)})`}
              </p>
              <div className='flex items-end gap-1.5'>
                <CountdownBlock value={h} label={t('Hours')} />
                <span className='mb-3 text-lg font-bold leading-none text-white/60'>:</span>
                <CountdownBlock value={m} label={t('Minutes')} />
                <span className='mb-3 text-lg font-bold leading-none text-white/60'>:</span>
                <CountdownBlock value={s} label={t('Seconds')} />
              </div>
            </div>

            <div className='flex flex-col items-start gap-1 sm:items-end'>
              <motion.div whileTap={{ scale: 0.95 }}>
                <Button
                  onClick={onEnter}
                  disabled={todayFinished || nextLocked || entered || entering || isNextDrawn}
                  className={cn(
                    'h-10 rounded-xl px-6 font-semibold shadow-lg transition-all',
                    todayFinished || nextLocked || entered || isNextDrawn
                      ? 'cursor-default border border-white/30 bg-white/20 text-white/70 hover:bg-white/20'
                      : 'bg-white text-violet-700 hover:bg-white/90'
                  )}
                >
                  {todayFinished ? (
                    <span className='flex items-center gap-1.5'>
                      <Clock className='size-4' />
                      {t("Today's draws finished")}
                    </span>
                  ) : entered ? (
                    <span className='flex items-center gap-1.5'>
                      <CheckCircle2 className='size-4' />
                      {t("You're In!")}
                    </span>
                  ) : nextLocked ? (
                    <span className='flex items-center gap-1.5'>
                      <Clock className='size-4' />
                      {t('Drawing soon')}
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
              {todayFinished ? (
                <p className='text-[10px] text-white/60'>
                  {t('Come back tomorrow for the next round 🎁')}
                </p>
              ) : entered && nextActivity ? (
                <p className='text-[10px] text-white/50'>
                  {t('Registered for {{date}} {{slot}}', {
                    date: nextIsTomorrow ? t('tomorrow') : nextActivity.draw_date,
                    slot: `${pad(nextActivity.slot_hour)}:${pad(nextActivity.slot_minute)}`,
                  })}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Today slots timeline */}
        {todayActivities.length > 0 && (
          <div className='rounded-xl border border-white/15 bg-white/5 p-4'>
            <p className='mb-3 text-[10px] font-medium uppercase tracking-wider text-white/50'>
              {t("Today's Schedule")}
            </p>
            <TodaySlotsTimeline activities={todayActivities} nextHour={nextHour} nextMinute={nextMinute} />
          </div>
        )}
      </div>
    </div>
  )
}


// ─── Result Dialog（中奖/未中奖 弹窗）────────────────────────────────────────
function ResultDialog({
  card,
  open,
  onClose,
}: {
  card: LuckyBagResultCard | null
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!card) return
    await copyToClipboard(card.activity.winner_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const particles = [
    { x: '8%',  y: '18%', size: 6, color: '#fbbf24', delay: 0 },
    { x: '90%', y: '12%', size: 8, color: '#f59e0b', delay: 0.15 },
    { x: '15%', y: '75%', size: 5, color: '#fcd34d', delay: 0.3 },
    { x: '82%', y: '70%', size: 7, color: '#fbbf24', delay: 0.1 },
    { x: '50%', y: '6%',  size: 5, color: '#fde68a', delay: 0.4 },
    { x: '30%', y: '88%', size: 6, color: '#f59e0b', delay: 0.25 },
    { x: '70%', y: '85%', size: 4, color: '#fcd34d', delay: 0.35 },
  ]

  return (
    <AnimatePresence>
      {open && card && (
        <>
          {/* Backdrop */}
          <motion.div
            key='backdrop'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className='fixed inset-0 z-50 bg-black/60 backdrop-blur-sm'
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
            key='dialog'
            initial={{ opacity: 0, scale: 0.88, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className='fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 px-4'
          >
            {card.is_winner ? (
              /* ── 中奖 ── */
              <div
                className='relative overflow-hidden rounded-2xl shadow-2xl'
                style={{ background: 'linear-gradient(135deg, #78350f 0%, #92400e 30%, #b45309 60%, #d97706 100%)' }}
              >
                {/* Shimmer */}
                <motion.div
                  className='pointer-events-none absolute inset-0'
                  style={{ background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.08) 50%, transparent 60%)' }}
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ repeat: Infinity, duration: 3.5, ease: 'linear', repeatDelay: 2 }}
                />
                {/* Particles */}
                {particles.map((p, i) => (
                  <motion.div
                    key={i}
                    className='pointer-events-none absolute rounded-full'
                    style={{ left: p.x, top: p.y, width: p.size, height: p.size, backgroundColor: p.color }}
                    animate={{ y: [0, -10, 0], opacity: [0.6, 1, 0.6] }}
                    transition={{ repeat: Infinity, duration: 2.4 + i * 0.2, delay: p.delay, ease: 'easeInOut' }}
                  />
                ))}
                {/* Close */}
                <button onClick={onClose} className='absolute right-3 top-3 z-20 flex size-7 items-center justify-center rounded-full bg-black/20 text-white/70 transition-colors hover:bg-black/40 hover:text-white cursor-pointer'>
                  <X className='size-3.5' />
                </button>

                <div className='relative z-10 flex flex-col gap-4 p-6'>
                  {/* Trophy + title */}
                  <div className='flex flex-col items-center gap-2 pt-2'>
                    <motion.div
                      animate={{ rotate: [-8, 8, -8], scale: [1, 1.12, 1] }}
                      transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
                      className='flex size-14 items-center justify-center rounded-2xl border border-yellow-300/30 bg-yellow-400/20'
                    >
                      <Trophy className='size-7 text-yellow-200' />
                    </motion.div>
                    <div className='text-center'>
                      <div className='flex items-center justify-center gap-1.5'>
                        <Sparkles className='size-4 text-yellow-300' />
                        <span className='text-xl font-bold text-white'>{t('Congratulations, you won!')}</span>
                        <Sparkles className='size-4 text-yellow-300' />
                      </div>
                      <p className='mt-0.5 text-sm text-yellow-200/70'>
                        {card.activity.draw_date} · {pad(card.activity.slot_hour)}:{pad(card.activity.slot_minute)} {t('Session')}
                      </p>
                    </div>
                    <div className='rounded-xl border border-yellow-400/30 bg-black/20 px-5 py-2 text-center'>
                      <p className='text-xs font-medium text-yellow-300/70'>{t('Prize Amount')}</p>
                      <p className='text-3xl font-bold tabular-nums text-white'>{formatQuota(card.activity.winner_quota)}</p>
                    </div>
                  </div>

                  {/* Code */}
                  <div className='h-px bg-yellow-400/20' />
                  <div>
                    <p className='mb-2 text-xs font-semibold uppercase tracking-wider text-yellow-300/70'>{t('Redemption Code')}</p>
                    <div className='rounded-xl border border-yellow-400/30 bg-black/25 p-3'>
                      <p className='font-mono text-xs font-semibold leading-relaxed break-all text-yellow-100 select-all'>
                        {card.activity.winner_code}
                      </p>
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        onClick={handleCopy}
                        className='mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-yellow-400 py-2 text-xs font-bold text-amber-900 transition-colors hover:bg-yellow-300 cursor-pointer'
                      >
                        <AnimatePresence mode='wait'>
                          {copied
                            ? <motion.span key='d' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className='flex items-center gap-1.5'><Check className='size-3.5' />{t('Copied')}</motion.span>
                            : <motion.span key='c' initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className='flex items-center gap-1.5'><Copy className='size-3.5' />{t('Copy Code')}</motion.span>
                          }
                        </AnimatePresence>
                      </motion.button>
                    </div>
                    <p className='mt-2 text-xs text-yellow-300/60'>{t('Go to Wallet → Redemption Code, enter the code above to receive your credit')}</p>
                  </div>
                </div>
              </div>
            ) : (
              /* ── 未中奖 ── */
              <div className='bg-card ring-foreground/10 relative overflow-hidden rounded-2xl p-6 ring-1 shadow-2xl'>
                <button onClick={onClose} className='absolute right-3 top-3 flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground cursor-pointer'>
                  <X className='size-3.5' />
                </button>
                <div className='flex flex-col items-center gap-3 text-center'>
                  <div className='flex size-14 items-center justify-center rounded-2xl bg-violet-500/10'>
                    <HeartCrack className='size-7 text-violet-400' />
                  </div>
                  <div>
                    <p className='text-base font-semibold'>{t('Sorry, you didn\'t win this time')}</p>
                    <p className='text-muted-foreground mt-1 text-sm'>
                      {card.activity.draw_date} · {pad(card.activity.slot_hour)}:{pad(card.activity.slot_minute)} {t('Session')}
                    </p>
                  </div>
                  <div className='bg-muted/50 w-full rounded-xl px-4 py-3 text-sm'>
                    <span className='text-muted-foreground'>{t('Winner:')}</span>
                    <span className='font-medium'>{card.activity.winner_name || t('Anonymous')}</span>
                    <span className='text-muted-foreground mx-1'>·</span>
                    <span className='font-medium'>{formatQuota(card.activity.winner_quota)}</span>
                  </div>
                  <p className='text-muted-foreground text-xs'>{t('Remember to enter earlier next time, good luck! 🤞')}</p>
                  <Button variant='outline' className='w-full' onClick={onClose}>{t('Got it')}</Button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── Rules Card ───────────────────────────────────────────────────────────────
function RulesCard({ drawSlots }: { drawSlots?: { hour: number; minute: number }[] }) {
  const { t } = useTranslation()
  const slots =
    drawSlots && drawSlots.length > 0
      ? drawSlots
      : [
          { hour: 9, minute: 0 },
          { hour: 12, minute: 0 },
          { hour: 17, minute: 0 },
        ]
  const rules = [
    t('{{count}} draws per day — {{slots}}', {
      count: slots.length,
      slots: slots.map((s) => `${pad(s.hour)}:${pad(s.minute)}`).join(', '),
    }),
    t('Enter each draw separately before the draw time'),
    t('One winner is selected daily via weighted random draw'),
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
function HistoryRowCode({ a }: { a: LuckyBagActivity }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const isUsed = a.winner_code_status === 3
  const handleCopy = async () => {
    await copyToClipboard(a.winner_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className='mt-2 flex flex-wrap items-center gap-2'>
      <code className='rounded bg-yellow-500/10 px-2 py-0.5 font-mono text-xs font-semibold tracking-wider text-yellow-700 dark:text-yellow-300 select-all'>
        {a.winner_code}
      </code>
      <span className={cn(
        'rounded-full px-2 py-0.5 text-[10px] font-semibold',
        isUsed
          ? 'bg-muted text-muted-foreground'
          : 'bg-green-500/10 text-green-700 dark:text-green-400'
      )}>
        {isUsed ? t('Used') : t('Unused')}
      </span>
      {!isUsed && (
        <button
          onClick={handleCopy}
          className='flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer'
        >
          {copied ? <><Check className='size-3' />{t('Copied')}</> : <><Copy className='size-3' />{t('Copy')}</>}
        </button>
      )}
    </div>
  )
}

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
          {activities.map((a, idx) => {
            const isMyWin = (a.winner_code_status ?? 0) > 0
            const isLatest = idx === 0 && page === 1
            return (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.04 }}
                className={cn(
                  'rounded-lg px-3.5 py-2.5 text-sm transition-colors',
                  isMyWin
                    ? 'border border-yellow-200/50 bg-gradient-to-r from-yellow-50 to-amber-50 dark:border-yellow-800/30 dark:from-yellow-950/20 dark:to-amber-950/20'
                    : isLatest
                      ? 'border border-yellow-200/30 bg-muted/40'
                      : 'bg-muted/30 hover:bg-muted/50'
                )}
              >
                <div className='flex items-center justify-between'>
                  <div className='flex min-w-0 items-center gap-2.5'>
                    {isMyWin ? (
                      <Trophy className='size-3.5 shrink-0 text-yellow-500' />
                    ) : (
                      <Gift className='size-3.5 shrink-0 text-muted-foreground/50' />
                    )}
                    <div className='min-w-0'>
                      <span className={cn('font-medium', isMyWin && 'text-yellow-800 dark:text-yellow-200')}>
                        {a.winner_name || t('Anonymous')}
                        {isMyWin && <span className='ml-1.5 text-xs font-normal text-yellow-600 dark:text-yellow-400'>（我）</span>}
                      </span>
                      <span className='text-muted-foreground ml-2 text-xs'>
                        {a.draw_date} {pad(a.slot_hour)}:{pad(a.slot_minute)}
                      </span>
                    </div>
                  </div>
                  <span className={cn(
                    'ml-2 shrink-0 text-xs font-semibold',
                    isMyWin ? 'text-yellow-700 dark:text-yellow-400' : 'text-foreground'
                  )}>
                    {formatQuota(a.winner_quota)}
                  </span>
                </div>
                {isMyWin && <HistoryRowCode a={a} />}
              </motion.div>
            )
          })}
        </div>
      )}

      {total > 0 && (
        <div className='flex items-center justify-between border-t border-border/50 pt-3'>
          <span className='text-muted-foreground text-xs'>
            第 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} 条，共 {total} 条
          </span>
          <div className='flex items-center gap-1'>
            <Button
              variant='outline'
              size='sm'
              className='h-7 px-2.5 text-xs'
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              {t('Prev')}
            </Button>
            <span className='text-muted-foreground min-w-[3rem] text-center text-xs'>
              {page} / {Math.max(totalPages, 1)}
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

  const [historyActivities, setHistoryActivities] = useState<LuckyBagActivity[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyLoading, setHistoryLoading] = useState(true)

  // 弹窗
  const [dialogCard, setDialogCard] = useState<LuckyBagResultCard | null>(null)

  const fetchStatus = useCallback(async (autoPopDialog = false) => {
    console.log('[LuckyBag] fetchStatus called', { autoPopDialog })
    try {
      const res = await getLuckyBagStatus()
      console.log('[LuckyBag] fetchStatus response', {
        success: res.success,
        entered: res.data?.entered,
        nextActivity: res.data?.next_activity ? `id=${res.data.next_activity.id} ${res.data.next_activity.draw_date} ${pad(res.data.next_activity.slot_hour)}:${pad(res.data.next_activity.slot_minute)} status=${res.data.next_activity.status}` : null,
        resultCards: res.data?.result_cards?.map(c => `id=${c.activity.id} winner=${c.is_winner} viewed=${c.winner_viewed} status=${c.activity.status}`),
        drawSlots: res.data?.draw_slots,
      })
      if (res.success && res.data) {
        setStatusData(res.data)
        setEntered(res.data.entered)
        // 自动弹窗：用户报名过且未查看过的当日开奖结果（中奖/未中奖都弹）
        if (autoPopDialog) {
          const today = new Date().toISOString().slice(0, 10)
          const todayCard = (res.data.result_cards ?? []).find(
            c => c.activity.draw_date === today && !c.winner_viewed
          )
          console.log('[LuckyBag] fetchStatus autoPopDialog today=', today, 'todayCard=', todayCard ?? null)
          if (todayCard) {
            setDialogCard(todayCard)
          }
        }
      }
    } catch (e) {
      console.error('[LuckyBag] fetchStatus error', e)
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
    fetchStatus(true)
    fetchHistory(1)
  }, [fetchStatus, fetchHistory])

  const handleEnter = async () => {
    if (entering || entered) return
    console.log('[LuckyBag] handleEnter: submitting entry')
    setEntering(true)
    try {
      const res = await enterLuckyBag()
      console.log('[LuckyBag] handleEnter response', { success: res.success, message: res.message, entry: res.data?.entry })
      if (res.success) {
        setEntered(true)
        toast.success(t('Successfully entered the draw!'))
        fetchStatus()
      } else {
        toast.error(res.message || t('Failed to enter'))
      }
    } catch (e) {
      console.error('[LuckyBag] handleEnter error', e)
      toast.error(t('Request failed'))
    } finally {
      setEntering(false)
    }
  }

  const handlePageChange = (page: number) => {
    setHistoryPage(page)
    fetchHistory(page)
  }

  // 倒计时跨越开奖时刻后，后端已在开奖前 1 分钟把结果写入 DB
  // 到点立即请求一次即可拿到结果；为了抵消时钟偏差/网络延迟，最多再重试几次
  const handleDrawTime = useCallback(() => {
    const maxAttempts = 6
    let attempts = 0
    const drawSlots = statusData?.draw_slots ?? [
      { hour: 9, minute: 0 },
      { hour: 12, minute: 0 },
      { hour: 17, minute: 0 },
    ]
    const now = new Date()
    const nowKey = now.getHours() * 60 + now.getMinutes()
    const lastPassed = (() => {
      let best: { hour: number; minute: number } | null = null
      for (const s of drawSlots) {
        if (nowKey >= s.hour * 60 + s.minute) {
          if (!best || (s.hour * 60 + s.minute) > (best.hour * 60 + best.minute)) {
            best = { hour: s.hour, minute: s.minute }
          }
        }
      }
      return best
    })()
    console.log('[LuckyBag] handleDrawTime fired', { nowKey, drawSlots, lastPassed })
    const check = async () => {
      attempts += 1
      console.log(`[LuckyBag] handleDrawTime check attempt=${attempts}/${maxAttempts}`, { lastPassed })
      try {
        const res = await getLuckyBagStatus()
        if (res.success && res.data) {
          setStatusData(res.data)
          setEntered(res.data.entered)
          const today = new Date().toISOString().slice(0, 10)
          const latest = lastPassed && (res.data.today_activities ?? []).find(
            a => a.draw_date === today && a.slot_hour === lastPassed.hour && a.slot_minute === lastPassed.minute
          )
          console.log('[LuckyBag] handleDrawTime check result', {
            attempt: attempts,
            latestSlotStatus: latest?.status ?? 'not found',
            resultCards: res.data.result_cards?.map(c => `id=${c.activity.id} winner=${c.is_winner} viewed=${c.winner_viewed}`),
          })
          if (latest && latest.status === 'drawn') {
            // 用户报名过刚过去这场：必须弹窗（中奖或未中奖）
            const card = (res.data.result_cards ?? []).find(
              c => c.activity.draw_date === today &&
                c.activity.slot_hour === lastPassed!.hour &&
                c.activity.slot_minute === lastPassed!.minute &&
                !c.winner_viewed
            )
            console.log('[LuckyBag] handleDrawTime slot drawn, card=', card ?? null)
            if (card) setDialogCard(card)
            fetchHistory(1)
            return
          }
        }
      } catch (e) {
        console.warn('[LuckyBag] handleDrawTime check error (will retry)', e)
      }
      if (attempts < maxAttempts) {
        console.log(`[LuckyBag] handleDrawTime not drawn yet, retrying in 3s (attempt ${attempts}/${maxAttempts})`)
        setTimeout(check, 3000)
      } else {
        console.warn('[LuckyBag] handleDrawTime max attempts reached, giving up')
      }
    }
    setTimeout(check, 500)
  }, [fetchHistory, statusData?.draw_slots])

  return (
    <>
    <ResultDialog
      card={dialogCard}
      open={dialogCard !== null}
      onClose={() => {
        if (dialogCard) {
          markLuckyBagViewed(dialogCard.activity.id).catch(() => {})
        }
        setDialogCard(null)
      }}
    />
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
                  onDrawTime={handleDrawTime}
                />
              </motion.div>
            </AnimatePresence>
          )}

          <RulesCard drawSlots={statusData?.draw_slots} />

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
    </>
  )
}
