import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Gift,
  Sparkles,
  Trophy,
  Clock,
  Copy,
  Check,
  X,
  ChevronRight,
  ChevronLeft,
  Hourglass,
  Bug,
  Loader2,
  PartyPopper,
} from 'lucide-react'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { getLuckyBagStatus, enterLuckyBag, getLuckyBagHistory, markLuckyBagViewed } from './api'
import { useNextDrawCountdown } from './hooks'
import type { LuckyBagActivity, LuckyBagResultCard, LuckyBagStatusResponse } from './types'

type DrawAnimationPhase = 'idle' | 'shaking' | 'opening'

const HISTORY_PAGE_SIZE = 10

function pad(n: number) {
  return n.toString().padStart(2, '0')
}

function splitWinnerDisplayName(name: string) {
  const trimmed = name.trim()
  const match = trimmed.match(/^(.*?)\s*[（(]\s*UID\s*(\d+)\s*[）)]$/i)

  if (!match) {
    return { name: trimmed, uid: '' }
  }

  return { name: match[1].trim(), uid: match[2] }
}

const PAGE_STARS = [
  { left: '6%', top: '8%', size: 2, opacity: 0.7, delay: 0.2 },
  { left: '14%', top: '19%', size: 4.2, opacity: 0.45, delay: 0.8 },
  { left: '23%', top: '6%', size: 1, opacity: 0.55, delay: 1.4 },
  { left: '34%', top: '13%', size: 2.5, opacity: 0.4, delay: 1.1 },
  { left: '49%', top: '6%', size: 2, opacity: 0.65, delay: 0.4 },
  { left: '64%', top: '15%', size: 1.5, opacity: 0.42, delay: 1.6 },
  { left: '72%', top: '9%', size: 3.6, opacity: 0.72, delay: 0.9 },
  { left: '81%', top: '23%', size: 2, opacity: 0.46, delay: 1.8 },
  { left: '91%', top: '11%', size: 1.5, opacity: 0.62, delay: 0.3 },
  { left: '9%', top: '42%', size: 1.5, opacity: 0.44, delay: 1.5 },
  { left: '21%', top: '76%', size: 3.2, opacity: 0.56, delay: 0.7 },
  { left: '37%', top: '58%', size: 1.5, opacity: 0.4, delay: 1.9 },
  { left: '52%', top: '86%', size: 2, opacity: 0.7, delay: 1.2 },
  { left: '70%', top: '77%', size: 1.5, opacity: 0.43, delay: 0.5 },
  { left: '83%', top: '63%', size: 4.4, opacity: 0.58, delay: 1.7 },
  { left: '95%', top: '44%', size: 2, opacity: 0.8, delay: 0.95 },
  { left: '4%', top: '67%', size: 2, opacity: 0.48, delay: 2.1 },
  { left: '12%', top: '88%', size: 1, opacity: 0.64, delay: 2.6 },
  { left: '18%', top: '33%', size: 2, opacity: 0.5, delay: 2.3 },
  { left: '29%', top: '87%', size: 1.5, opacity: 0.38, delay: 0.15 },
  { left: '41%', top: '28%', size: 2, opacity: 0.54, delay: 2.8 },
  { left: '46%', top: '71%', size: 1.5, opacity: 0.46, delay: 2.4 },
  { left: '57%', top: '35%', size: 3.8, opacity: 0.5, delay: 2.2 },
  { left: '61%', top: '92%', size: 1.5, opacity: 0.58, delay: 1.35 },
  { left: '76%', top: '49%', size: 2, opacity: 0.5, delay: 2.95 },
  { left: '88%', top: '82%', size: 1.5, opacity: 0.62, delay: 2.55 },
  { left: '93%', top: '70%', size: 4, opacity: 0.4, delay: 1.05 },
  { left: '97%', top: '31%', size: 1.5, opacity: 0.55, delay: 2.75 },
]

function getRowStyle(index: number) {
  const palette = [
    {
      chip: 'linear-gradient(180deg, #fbbf24 0%, #d97706 100%)',
      glow: 'rgba(251,191,36,0.34)',
      accent: '#fcd34d',
    },
    {
      chip: 'linear-gradient(180deg, #a855f7 0%, #7c3aed 100%)',
      glow: 'rgba(168,85,247,0.3)',
      accent: '#c084fc',
    },
    {
      chip: 'linear-gradient(180deg, #22d3ee 0%, #0284c7 100%)',
      glow: 'rgba(34,211,238,0.28)',
      accent: '#67e8f9',
    },
    {
      chip: 'linear-gradient(180deg, #fb7185 0%, #e11d48 100%)',
      glow: 'rgba(251,113,133,0.28)',
      accent: '#fda4af',
    },
    {
      chip: 'linear-gradient(180deg, #34d399 0%, #059669 100%)',
      glow: 'rgba(52,211,153,0.26)',
      accent: '#6ee7b7',
    },
    {
      chip: 'linear-gradient(180deg, #f59e0b 0%, #ea580c 100%)',
      glow: 'rgba(245,158,11,0.28)',
      accent: '#fdba74',
    },
  ]

  return palette[index % palette.length]
}

function getAvatarInitial(name?: string) {
  const initial = name?.trim().charAt(0)
  return initial ? initial.toLocaleUpperCase() : 'A'
}

function buildDebugActivity(overrides: Partial<LuckyBagActivity> = {}): LuckyBagActivity {
  const now = new Date()
  const timestamp = Math.floor(now.getTime() / 1000)

  return {
    id: -Math.floor(Math.random() * 1_000_000) - 1,
    draw_date: now.toISOString().slice(0, 10),
    slot_hour: 12,
    slot_minute: 0,
    min_quota: 0,
    max_quota: 0,
    status: 'pending',
    winner_user_id: 0,
    winner_name: '',
    winner_quota: 0,
    winner_code: '',
    drawn_at: 0,
    created_at: timestamp,
    ...overrides,
  }
}

// =============================================================================
// Activity card (left column)
// Composition: LuckyBagHero · CountdownPanel · JoinStatusButton ·
//              DrawProgressTimeline. Restrained, single-accent palette.
// =============================================================================

// ─── CountdownTile — single hours / minutes / seconds tile ──────────────────
function CountdownTile({ value, label }: { value: number; label: string }) {
  return (
    <div className='flex flex-1 flex-col items-center gap-1'>
      <div
        className='relative flex h-[38px] w-full items-center justify-center overflow-hidden rounded-[14px] sm:h-[42px]'
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.025) 100%)',
          boxShadow:
            'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06), 0 10px 26px -18px rgba(217,174,69,0.6)',
        }}
      >
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/40 to-transparent'
        />
        <div
          aria-hidden
          className='pointer-events-none absolute inset-0'
          style={{
            background:
              'radial-gradient(ellipse 70% 55% at 50% 0%, rgba(250,204,21,0.12), transparent 72%)',
          }}
        />
        <AnimatePresence mode='popLayout' initial={false}>
          <motion.span
            key={value}
            initial={{ y: '-110%', opacity: 0, filter: 'blur(4px)' }}
            animate={{
              y: '0%',
              opacity: 1,
              filter: 'blur(0px)',
              transition: {
                y: { type: 'spring', stiffness: 380, damping: 32, mass: 0.85 },
                opacity: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
                filter: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
              },
            }}
            exit={{
              y: '110%',
              opacity: 0,
              filter: 'blur(4px)',
              transition: {
                y: { duration: 0.42, ease: [0.32, 0.72, 0.24, 1] },
                opacity: { duration: 0.26, ease: 'easeOut' },
                filter: { duration: 0.28, ease: 'easeOut' },
              },
            }}
            className='absolute inset-0 flex items-center justify-center text-[1.2rem] font-semibold leading-none tabular-nums sm:text-[1.4rem]'
            style={{
              background:
                'linear-gradient(180deg, #f8e08a 0%, #d8ae45 60%, #a66f12 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              willChange: 'transform, opacity, filter',
            }}
          >
            {pad(value)}
          </motion.span>
        </AnimatePresence>
      </div>
      <span className='text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500'>
        {label}
      </span>
    </div>
  )
}

// ─── CountdownPanel — focal countdown surface (clean, single accent) ────────
function CountdownPanel({
  hours,
  minutes,
  seconds,
  nextHour,
  nextMinute,
  todayFinished,
}: {
  hours: number
  minutes: number
  seconds: number
  nextHour: number
  nextMinute: number
  todayFinished: boolean
}) {
  const { t } = useTranslation()
  const slotLabel = `${pad(nextHour)}:${pad(nextMinute)}`
  const headLabel = todayFinished ? t('Next draw: Tomorrow {{slot}}', { slot: slotLabel }) : t('Next Draw')

  return (
    <div className='rounded-[18px] border border-white/8 bg-white/[0.03] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'>
      <div className='flex items-baseline justify-between'>
        <p className='flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.34em] text-zinc-400'>
          <Clock className='size-3 text-amber-300' />
          {headLabel}
        </p>
        {!todayFinished && (
          <p className='text-[11px] font-semibold tabular-nums text-amber-200/85'>
            {slotLabel}
          </p>
        )}
      </div>

      <div className='mt-1.5 flex items-end gap-1.5 sm:gap-2'>
        <CountdownTile value={hours} label={t('Hours')} />
        <span
          aria-hidden
          className='mb-4 text-base font-bold leading-none text-amber-200 sm:mb-4 sm:text-lg'
        >
          :
        </span>
        <CountdownTile value={minutes} label={t('Minutes')} />
        <span
          aria-hidden
          className='mb-4 text-base font-bold leading-none text-amber-200 sm:mb-4 sm:text-lg'
        >
          :
        </span>
        <CountdownTile value={seconds} label={t('Seconds')} />
      </div>
    </div>
  )
}

// ─── JoinStatusButton — primary CTA with restrained state branches ──────────
function JoinStatusButton({
  entered,
  entering,
  todayFinished,
  nextLocked,
  isNextDrawn,
  onEnter,
  hint,
}: {
  entered: boolean
  entering: boolean
  todayFinished: boolean
  nextLocked: boolean
  isNextDrawn: boolean
  onEnter: () => void
  hint?: string
}) {
  const { t } = useTranslation()
  const canEnter = !entered && !entering && !todayFinished && !nextLocked && !isNextDrawn

  const disabledShell =
    'flex h-10 w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] text-xs font-semibold text-zinc-500'

  let body: React.ReactNode

  if (todayFinished) {
    body = (
      <div className={disabledShell}>
        <Clock className='size-4' />
        {t("Today's draws finished")}
      </div>
    )
  } else if (entering) {
    body = (
      <div
        className='flex h-10 w-full items-center justify-center gap-2 rounded-full text-xs font-bold text-zinc-950'
        style={{
          background:
            'linear-gradient(180deg, #f7e089 0%, #d8ae45 55%, #b67d14 100%)',
          boxShadow:
            '0 16px 36px -12px rgba(217,174,69,0.75), inset 0 1px 0 rgba(255,255,255,0.45)',
        }}
      >
        <Loader2 className='size-4 animate-spin' />
        {t('Entering...')}
      </div>
    )
  } else if (entered) {
    body = (
      <button
        type='button'
        disabled
        aria-disabled='true'
        className='flex h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full border border-amber-200/16 text-xs font-bold tracking-wide text-amber-100/52'
        style={{
          background:
            'linear-gradient(180deg, rgba(217,174,69,0.16) 0%, rgba(129,91,24,0.12) 100%)',
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.22)',
        }}
      >
        <Check className='size-4 text-amber-100/52' strokeWidth={3} />
        <span>{t('Entered')}</span>
      </button>
    )
  } else if (nextLocked) {
    body = (
      <div className={disabledShell}>
        <Hourglass className='size-4' />
        {t('Drawing soon')}
      </div>
    )
  } else if (isNextDrawn) {
    body = <div className={disabledShell}>{t('Already drawn')}</div>
  } else {
    body = (
      <motion.button
        type='button'
        onClick={canEnter ? onEnter : undefined}
        disabled={!canEnter}
        whileHover={canEnter ? { scale: 1.015 } : undefined}
        whileTap={canEnter ? { scale: 0.98 } : undefined}
        transition={{ duration: 0.15 }}
        className='group relative flex h-10 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full text-xs font-bold tracking-wide text-zinc-950 disabled:cursor-default'
        style={{
          background:
            'linear-gradient(180deg, #f7e089 0%, #d8ae45 45%, #b67d14 100%)',
          boxShadow:
            '0 20px 44px -16px rgba(217,174,69,0.8), inset 0 1px 0 rgba(255,255,255,0.42), inset 0 -2px 0 rgba(115,77,15,0.35), 0 0 0 1px rgba(255,236,170,0.45)',
        }}
      >
        {/* shine sweep */}
        <motion.span
          aria-hidden
          className='pointer-events-none absolute inset-0'
          style={{
            background:
              'linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.4) 50%, transparent 65%)',
          }}
          animate={{ x: ['-120%', '220%'] }}
          transition={{
            repeat: Infinity,
            duration: 2.6,
            ease: 'easeInOut',
            repeatDelay: 1.8,
          }}
        />
        <Sparkles className='size-4 text-zinc-950/90 drop-shadow-[0_0_6px_rgba(255,255,255,0.35)]' />
        <span className='relative'>{t('Enter Lucky Bag Draw')}</span>
        <ChevronRight className='relative size-4 transition-transform group-hover:translate-x-0.5' />
      </motion.button>
    )
  }

  return (
    <div className='space-y-1.5'>
      {body}
      {hint && <p className='text-center text-[11px] leading-4 text-zinc-400'>{hint}</p>}
    </div>
  )
}

// ─── DrawProgressTimeline — minimal horizontal timeline of today's slots ────
function DrawProgressTimeline({
  activities,
  nextHour,
  nextMinute,
}: {
  activities: LuckyBagActivity[]
  nextHour: number
  nextMinute: number
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const slots = [...activities]
    .sort((a, b) => a.slot_hour - b.slot_hour || a.slot_minute - b.slot_minute)
    .map((a) => ({
      hour: a.slot_hour,
      minute: a.slot_minute,
      label: `${pad(a.slot_hour)}:${pad(a.slot_minute)}`,
      activity: a,
    }))

  const drawnCount = slots.filter((s) => s.activity.status === 'drawn').length
  const progressRatio =
    slots.length <= 1 ? 0 : Math.min(1, drawnCount / (slots.length - 1))

  return (
    <div className='rounded-[18px] border border-white/8 bg-white/[0.025] p-2.5'>
      <div className='mb-1.5 flex items-center justify-between gap-3'>
        <p className='flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.34em] text-zinc-400'>
          <Trophy className='size-3 text-amber-300' />
          {t("Today's Draw Progress")}
        </p>
        <span className='rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-200'>
          {drawnCount}
          <span className='text-amber-200/45'>/{slots.length}</span>
        </span>
      </div>

      <div className='relative'>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-6 top-[9px] h-[2px] rounded-full bg-white/6'
        />
        <div
          aria-hidden
          className='pointer-events-none absolute left-6 top-[9px] h-[2px] rounded-full transition-[width] duration-700 ease-out'
          style={{
            width: `calc((100% - 3rem) * ${progressRatio})`,
            background:
              'linear-gradient(90deg, #f7e089 0%, #d8ae45 50%, #b67d14 100%)',
            boxShadow: '0 0 12px rgba(217,174,69,0.45)',
          }}
        />

        <div
          className='relative grid items-start gap-2'
          style={{ gridTemplateColumns: `repeat(${slots.length || 1}, minmax(0, 1fr))` }}
        >
          {slots.map((slot, idx) => {
            const activity = slot.activity
            const isDrawn = activity.status === 'drawn'
            const slotKey = slot.hour * 60 + slot.minute
            const now = new Date()
            const nowKey = now.getHours() * 60 + now.getMinutes()
            const isPastTime = nowKey >= slotKey
            const isNext =
              !isDrawn && !isPastTime && slot.hour === nextHour && slot.minute === nextMinute
            const isAwaiting = !isDrawn && isPastTime
            const winners = [activity.winner_name, activity.winner2_name, activity.winner3_name].filter(Boolean)
            const winnerDisplay = winners.length > 0 ? splitWinnerDisplayName(winners[0]) : null

            return (
              <div
                key={`${slot.hour}-${slot.minute}-${idx}`}
                className='flex min-w-0 flex-col items-center gap-1.5'
              >
                <div className='relative flex h-[20px] items-center justify-center'>
                  <div
                    className={cn(
                      'relative z-10 flex items-center justify-center rounded-full transition-all',
                      isDrawn ? 'size-[20px]' : 'size-[16px]',
                    )}
                    style={
                      isDrawn
                        ? {
                            background:
                              'linear-gradient(180deg, #f7e089 0%, #d8ae45 60%, #b67d14 100%)',
                            boxShadow:
                              '0 3px 10px -2px rgba(217,174,69,0.55), inset 0 1px 0 rgba(255,255,255,0.5), 0 0 0 1px rgba(255,255,255,0.8)',
                          }
                        : isNext
                          ? {
                              background:
                                'linear-gradient(180deg, #f7e089 0%, #d8ae45 60%, #b67d14 100%)',
                              boxShadow:
                                '0 0 0 2px rgba(255,238,181,0.9), 0 2px 10px -2px rgba(217,174,69,0.55)',
                            }
                          : {
                              background: 'rgba(255,255,255,0.94)',
                              boxShadow:
                                'inset 0 0 0 1px rgba(255,255,255,0.08)',
                            }
                    }
                  >
                    {isDrawn && (
                      <Gift
                        className='size-2.5 text-zinc-950 drop-shadow-[0_1px_1px_rgba(255,255,255,0.4)]'
                        strokeWidth={2.6}
                      />
                    )}
                    {isNext && !reduce && (
                      <span
                        className='absolute inset-0 -m-1.5 animate-ping rounded-full'
                        style={{ background: 'rgba(217,174,69,0.24)' }}
                      />
                    )}
                  </div>
                </div>

                <div className='min-w-0 text-center leading-tight'>
                  <p
                    className={cn(
                      'text-xs tabular-nums',
                      isDrawn
                        ? 'font-bold text-amber-300'
                        : isNext
                          ? 'font-bold text-amber-200'
                          : 'text-zinc-500',
                    )}
                  >
                    {slot.label}
                  </p>
                  <div className='mt-0.5 min-h-[1.1rem]'>
                    {isDrawn ? (
                      winnerDisplay ? (
                        <div title={winners.join(' / ')}>
                          <p className='block max-w-full truncate text-[10px] font-semibold text-zinc-100'>
                            {winnerDisplay.name}
                          </p>
                          {winners.length > 1 && (
                            <p className='text-[9px] text-zinc-500'>+{winners.length - 1}</p>
                          )}
                        </div>
                      ) : (
                        <p className='text-[10px] text-zinc-500'>{t('No entries')}</p>
                      )
                    ) : isNext ? (
                      <p className='text-[10px] font-bold text-amber-200'>
                        {t('Up Next')}
                      </p>
                    ) : isAwaiting ? (
                      <p className='text-[10px] text-zinc-500'>{t('Drawing...')}</p>
                    ) : (
                      <p className='text-[10px] text-zinc-600'>{t('Pending')}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── ActivityCard — composes the four pieces inside a clean shell ───────────
function ActivityCard({
  statusData,
  entered,
  participantCount,
  onEnter,
  entering,
  drawAnimationPhase,
}: {
  statusData: LuckyBagStatusResponse | null
  entered: boolean
  participantCount: number
  onEnter: () => void
  entering: boolean
  drawAnimationPhase: DrawAnimationPhase
}) {
  const { t } = useTranslation()
  const bagButtonRef = useRef<HTMLButtonElement | null>(null)
  const nextActivity = statusData?.next_activity
  const isNextDrawn = nextActivity?.status === 'drawn'
  const nextLocked = statusData?.next_locked ?? false
  const todayFinished = statusData?.today_finished ?? false
  const drawBusy = drawAnimationPhase !== 'idle'
  const bagDisabled = entering || entered || todayFinished || nextLocked || isNextDrawn || drawBusy

  const hint = todayFinished || entered
    ? undefined
    : t('One ticket per draw · Free to enter')

  const bagAnimate =
    drawAnimationPhase === 'shaking'
      ? {
          rotate: [0, -6, 6, -4, 4, -2, 2, -1, 1, 0],
          scale: [1, 1.02, 1.02, 1.04, 1.04, 1.06, 1.06, 1.04, 1.02, 1.01],
          y: 0,
          opacity: 1,
        }
      : drawAnimationPhase === 'opening'
        ? {
            rotate: [0, -3, 3, 15],
            scale: [1, 1.15, 1.1, 0],
            y: 0,
            opacity: [1, 1, 1, 0],
          }
        : {
            rotate: 0,
            scale: 1,
            opacity: 1,
            y: entering ? [0, -4, 0] : [0, -8, 0],
          }

  const bagTransition =
    drawAnimationPhase === 'shaking'
      ? { duration: 0.8, ease: 'easeInOut' }
      : drawAnimationPhase === 'opening'
        ? { duration: 0.6, ease: 'easeIn' }
        : {
            y: {
              duration: entering ? 1.2 : 5.5,
              repeat: Infinity,
              ease: 'easeInOut',
            },
            rotate: { duration: 0.2, ease: 'easeOut' },
            scale: { duration: 0.2, ease: 'easeOut' },
            opacity: { duration: 0.2, ease: 'easeOut' },
          }


  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className='relative flex flex-col overflow-hidden rounded-[26px] border border-white/8 bg-[#12101b]/92 shadow-[0_28px_70px_-36px_rgba(0,0,0,0.8)]'
      style={{
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.05), 0 30px 70px -34px rgba(0,0,0,0.86)',
      }}
    >
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(circle at 50% 0%, rgba(217,174,69,0.08), transparent 36%), radial-gradient(circle at 0% 100%, rgba(124,58,237,0.12), transparent 34%), radial-gradient(circle at 100% 30%, rgba(34,211,238,0.07), transparent 32%)',
        }}
      />
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.02), transparent 16%, transparent 84%, rgba(255,255,255,0.03))',
        }}
      />
      <div className='relative flex flex-1 flex-col gap-2 p-2.5 sm:p-3 lg:p-3.5'>
        <div className='relative flex flex-1 flex-col items-center justify-center gap-2 py-0'>
          <div className='flex w-full items-center justify-start'>
            <span className='inline-flex items-center gap-1.5 rounded-full border border-amber-300/16 bg-amber-300/8 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.24em] text-amber-200/70'>
              <span className='size-1.5 rounded-full bg-amber-300 shadow-[0_0_18px_rgba(250,204,21,0.8)]' />
              {t('Lucky Bag Label')}
            </span>
          </div>

          <motion.button
            ref={bagButtonRef}
            type='button'
            onClick={bagDisabled ? undefined : onEnter}
            disabled={bagDisabled}
            whileHover={bagDisabled ? undefined : { scale: 1.01 }}
            whileTap={bagDisabled ? undefined : { scale: 0.99 }}
            className='group relative flex aspect-square w-full max-w-[22rem] items-center justify-center rounded-full outline-none disabled:cursor-default'
            aria-label={t('Open Lucky Bag')}
          >
            <motion.div
              aria-hidden
              className='absolute inset-0 rounded-full'
              style={{
                background:
                  'radial-gradient(circle, rgba(201,168,76,0.08) 0%, transparent 70%)',
              }}
              animate={{
                boxShadow: [
                  '0 0 20px rgba(201,168,76,0.3), 0 0 40px rgba(201,168,76,0.1)',
                  '0 0 40px rgba(201,168,76,0.6), 0 0 80px rgba(201,168,76,0.3)',
                  '0 0 20px rgba(201,168,76,0.3), 0 0 40px rgba(201,168,76,0.1)',
                ],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
            <motion.div
              animate={bagAnimate}
              transition={bagTransition}
              className='relative flex size-[min(46vw,16.8rem)] items-center justify-center'
              style={{ transformOrigin: '50% 70%' }}
            >
              <svg
                className='relative h-full w-full overflow-visible'
                viewBox='0 0 320 320'
                role='img'
                aria-label={t('Lucky Bag Label')}
              >
                <defs>
                  <linearGradient id='lucky-bag-body' x1='64' x2='244' y1='92' y2='282' gradientUnits='userSpaceOnUse'>
                    <stop offset='0' stopColor='#7252a4' />
                    <stop offset='0.48' stopColor='#4c2a78' />
                    <stop offset='1' stopColor='#2d1b4f' />
                  </linearGradient>
                  <linearGradient id='lucky-bag-gold' x1='80' x2='242' y1='58' y2='266' gradientUnits='userSpaceOnUse'>
                    <stop offset='0' stopColor='#fff7b3' />
                    <stop offset='0.45' stopColor='#facc15' />
                    <stop offset='1' stopColor='#d97706' />
                  </linearGradient>
                  <linearGradient id='lucky-bag-band' x1='46' x2='274' y1='155' y2='155' gradientUnits='userSpaceOnUse'>
                    <stop offset='0' stopColor='rgba(250,204,21,0.62)' />
                    <stop offset='0.5' stopColor='rgba(255,231,102,0.82)' />
                    <stop offset='1' stopColor='rgba(217,119,6,0.56)' />
                  </linearGradient>
                  <linearGradient id='lucky-bag-highlight' x1='82' x2='204' y1='104' y2='238' gradientUnits='userSpaceOnUse'>
                    <stop offset='0' stopColor='rgba(233,213,255,0.28)' />
                    <stop offset='0.42' stopColor='rgba(167,139,250,0.12)' />
                    <stop offset='1' stopColor='rgba(255,255,255,0)' />
                  </linearGradient>
                  <filter id='lucky-bag-glow' x='-30%' y='-30%' width='160%' height='160%'>
                    <feGaussianBlur stdDeviation='8' result='blur' />
                    <feColorMatrix
                      in='blur'
                      type='matrix'
                      values='1 0 0 0 0.85 0 1 0 0 0.58 0 0 1 0 0.16 0 0 0 0.62 0'
                    />
                    <feMerge>
                      <feMergeNode />
                      <feMergeNode in='SourceGraphic' />
                    </feMerge>
                  </filter>
                </defs>

                <ellipse cx='160' cy='264' rx='96' ry='16' fill='rgba(0,0,0,0.26)' />
                <path
                  d='M118 102 C118 50 202 50 202 102'
                  fill='none'
                  stroke='url(#lucky-bag-gold)'
                  strokeLinecap='round'
                  strokeWidth='18'
                  filter='url(#lucky-bag-glow)'
                />
                <path
                  d='M82 112 C82 100 91 94 104 94 H216 C229 94 238 100 238 112 L254 250 C257 272 244 282 222 282 H98 C76 282 63 272 66 250 Z'
                  fill='url(#lucky-bag-body)'
                  stroke='url(#lucky-bag-gold)'
                  strokeLinejoin='round'
                  strokeWidth='3'
                  filter='url(#lucky-bag-glow)'
                />
                <path
                  d='M96 116 H162 C140 148 124 190 117 248 H92 C77 248 73 241 76 225 L87 132 C88 123 91 119 96 116 Z'
                  fill='url(#lucky-bag-highlight)'
                  opacity='0.82'
                />
                <path
                  d='M82 112 C82 100 91 94 104 94 H216 C229 94 238 100 238 112'
                  fill='none'
                  stroke='rgba(255,244,205,0.5)'
                  strokeLinecap='round'
                  strokeWidth='2'
                />
                <path d='M58 148 L262 148 L268 174 L52 174 Z' fill='url(#lucky-bag-band)' opacity='0.3' />
                <line x1='58' y1='148' x2='262' y2='148' stroke='url(#lucky-bag-band)' strokeWidth='1.5' opacity='0.55' />
                <line x1='52' y1='174' x2='268' y2='174' stroke='url(#lucky-bag-band)' strokeWidth='1.5' opacity='0.45' />
                <path
                  d='M132 130 C108 111 92 120 88 137 C85 151 105 158 129 150 L143 140 Z'
                  fill='url(#lucky-bag-gold)'
                  filter='url(#lucky-bag-glow)'
                />
                <path
                  d='M188 130 C212 111 228 120 232 137 C235 151 215 158 191 150 L177 140 Z'
                  fill='url(#lucky-bag-gold)'
                  filter='url(#lucky-bag-glow)'
                />
                <circle cx='160' cy='139' r='16' fill='url(#lucky-bag-gold)' filter='url(#lucky-bag-glow)' />
                <circle cx='160' cy='139' r='6' fill='rgba(126,82,14,0.2)' />
                <path
                  d='M155 151 L124 230'
                  fill='none'
                  stroke='url(#lucky-bag-gold)'
                  strokeLinecap='round'
                  strokeWidth='10'
                  filter='url(#lucky-bag-glow)'
                />
                <path
                  d='M165 151 L196 230'
                  fill='none'
                  stroke='url(#lucky-bag-gold)'
                  strokeLinecap='round'
                  strokeWidth='10'
                  filter='url(#lucky-bag-glow)'
                />
                <text
                  x='160'
                  y='238'
                  textAnchor='middle'
                  fontFamily='"Songti SC", "STKaiti", "Kaiti SC", serif'
                  fontSize='48'
                  fontWeight='700'
                  fill='#fde047'
                >
                  福
                </text>
                <circle cx='84' cy='230' r='5' fill='#facc15' />
                <circle cx='222' cy='210' r='5' fill='#facc15' opacity='0.86' />
                <circle cx='120' cy='254' r='3' fill='#fde047' opacity='0.8' />
                <circle cx='94' cy='178' r='3' fill='#fde047' opacity='0.72' />
              </svg>
            </motion.div>
          </motion.button>

          <div className='w-full max-w-[16.5rem] space-y-1.5 text-center'>
            <p className='text-[10px] leading-4 text-zinc-500'>
              {t('Registered Participants')}
              <span className='ml-1 font-semibold tabular-nums text-amber-200'>
                {participantCount}
              </span>
            </p>
            <JoinStatusButton
              entered={entered}
              entering={entering}
              todayFinished={todayFinished}
              nextLocked={nextLocked}
              isNextDrawn={isNextDrawn}
              onEnter={onEnter}
              hint={hint}
            />
          </div>
        </div>

      </div>
    </motion.div>
  )
}

function DrawStatusPanel({
  statusData,
  onDrawTime,
}: {
  statusData: LuckyBagStatusResponse | null
  onDrawTime: () => void
}) {
  const {
    hour: nextHour,
    minute: nextMinute,
    h,
    m,
    s,
  } = useNextDrawCountdown(statusData?.draw_slots, onDrawTime)
  const todayActivities = statusData?.today_activities ?? []
  const todayFinished = statusData?.today_finished ?? false

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}
      className='grid gap-2 rounded-[24px] border border-[#5f4d21]/55 bg-[#111019]/92 p-2.5 shadow-[0_22px_54px_-34px_rgba(0,0,0,0.86)] lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]'
      style={{
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 56px -34px rgba(0,0,0,0.86)',
      }}
    >
      <CountdownPanel
        hours={h}
        minutes={m}
        seconds={s}
        nextHour={nextHour}
        nextMinute={nextMinute}
        todayFinished={todayFinished}
      />

      {todayActivities.length > 0 && (
        <DrawProgressTimeline
          activities={todayActivities}
          nextHour={nextHour}
          nextMinute={nextMinute}
        />
      )}
    </motion.div>
  )
}

// ─── Result Dialog: Winner ───────────────────────────────────────────────────
// Dark obsidian + gold-leaf gala-invitation aesthetic, intentionally NOT theme-aware
// — winning a draw should feel like an event, not just another card.
function WinnerCard({ card, onClose }: { card: LuckyBagResultCard; onClose: () => void }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const rank = card.winner_rank || 1
  const rankLabels: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
  const rankLabel = rankLabels[rank] ?? '🏅'

  // 根据名次取对应的 quota 和 code
  const winnerQuota =
    rank === 1 ? card.activity.winner_quota
    : rank === 2 ? card.activity.winner2_quota
    : card.activity.winner3_quota
  const winnerCode =
    rank === 1 ? card.activity.winner_code
    : rank === 2 ? card.activity.winner2_code
    : card.activity.winner3_code

  const handleCopy = async () => {
    await copyToClipboard(winnerCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Sparkle dust positions — sparse, tasteful, never blocking content.
  const sparkles = [
    { x: '8%', y: '14%', size: 3, delay: 0.0, duration: 2.4 },
    { x: '90%', y: '10%', size: 4, delay: 0.4, duration: 2.8 },
    { x: '5%', y: '46%', size: 2, delay: 0.8, duration: 2.2 },
    { x: '93%', y: '40%', size: 3, delay: 1.2, duration: 2.6 },
    { x: '14%', y: '82%', size: 2, delay: 0.6, duration: 2.4 },
    { x: '86%', y: '86%', size: 3, delay: 1.0, duration: 2.5 },
  ]

  return (
    <div
      className='relative overflow-hidden rounded-2xl'
      style={{
        background:
          'linear-gradient(180deg, #1c140d 0%, #110c08 55%, #0a0706 100%)',
        boxShadow:
          '0 30px 60px -15px rgba(0,0,0,0.65), 0 0 0 1px rgba(212,175,55,0.22), inset 0 1px 0 rgba(255,235,180,0.10)',
      }}
    >
      {/* Warm spotlight from above — like stage lighting */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(ellipse 110% 55% at 50% -8%, rgba(212,175,55,0.28), transparent 60%)',
        }}
      />
      {/* Subtle floor vignette */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 bottom-0 h-2/5'
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.4), transparent)',
        }}
      />
      {/* Top gold foil hairline */}
      <div className='pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/80 to-transparent' />
      {/* Bottom gold foil hairline */}
      <div className='pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-amber-300/35 to-transparent' />
      {/* One-time gold sweep on entrance */}
      <motion.div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-px'
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(252,211,77,1), transparent)',
        }}
        initial={{ x: '-100%' }}
        animate={{ x: '100%' }}
        transition={{ duration: 2.4, ease: 'easeInOut', delay: 0.3 }}
      />
      {/* Slow shimmer sweep across the card */}
      <motion.div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'linear-gradient(105deg, transparent 40%, rgba(252,211,77,0.07) 50%, transparent 60%)',
        }}
        animate={{ x: ['-100%', '200%'] }}
        transition={{ repeat: Infinity, duration: 4.5, ease: 'linear', repeatDelay: 2.5 }}
      />

      {/* Sparkle dust */}
      {sparkles.map((s, i) => (
        <motion.div
          key={i}
          aria-hidden
          className='pointer-events-none absolute rounded-full'
          style={{
            left: s.x,
            top: s.y,
            width: s.size,
            height: s.size,
            background:
              'radial-gradient(circle, rgba(252,211,77,0.95), rgba(252,211,77,0))',
          }}
          animate={{ opacity: [0, 1, 0], scale: [0.5, 1.15, 0.5] }}
          transition={{
            duration: s.duration,
            delay: s.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}

      {/* Close — gold-tinted to harmonize */}
      <button
        type='button'
        onClick={onClose}
        className='absolute right-3 top-3 z-20 flex size-7 cursor-pointer items-center justify-center rounded-full text-amber-200/40 transition-colors hover:bg-amber-300/10 hover:text-amber-100'
        aria-label='Close'
      >
        <X className='size-3.5' />
      </button>

      <div className='relative z-10 flex flex-col items-center gap-5 px-6 pb-6 pt-9'>
        {/* Medallion: gold conic-ring frame around obsidian disc with trophy */}
        <motion.div
          initial={{ scale: 0.55, rotate: -14, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.15 }}
          className='relative'
        >
          <div
            className='flex size-[5.25rem] items-center justify-center rounded-full'
            style={{
              background:
                'conic-gradient(from 220deg, #d4af37, #f5d690, #b88a2c, #fde68a, #d4af37)',
              padding: '1.5px',
              boxShadow:
                '0 8px 24px -6px rgba(212,175,55,0.45), 0 0 0 1px rgba(212,175,55,0.3)',
            }}
          >
            <div
              className='flex size-full items-center justify-center rounded-full'
              style={{
                background:
                  'radial-gradient(circle at 32% 24%, #2a1d10 0%, #0d0805 80%)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,235,180,0.18), inset 0 -3px 10px rgba(0,0,0,0.6)',
              }}
            >
              <Trophy
                className='size-9'
                style={{
                  color: '#f5d690',
                  filter: 'drop-shadow(0 2px 4px rgba(212,175,55,0.45))',
                }}
              />
            </div>
          </div>
          {/* Orbiting sparkle */}
          <motion.div
            className='absolute -right-1 -top-1'
            animate={{
              rotate: 360,
              scale: [1, 1.18, 1],
            }}
            transition={{
              rotate: { duration: 8, repeat: Infinity, ease: 'linear' },
              scale: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' },
            }}
          >
            <Sparkles className='size-4 text-amber-200' />
          </motion.div>
        </motion.div>

        {/* Title block — wedding-invitation hierarchy */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className='text-center'
        >
          <p className='text-[10px] font-medium uppercase tracking-[0.32em] text-amber-300/70'>
            {t('Winner Notice')}
          </p>
          <div className='mt-2 flex items-center justify-center gap-2'>
            <span className='text-2xl'>{rankLabel}</span>
            <span
              className='text-2xl font-bold leading-tight tracking-tight'
              style={{
                background:
                  'linear-gradient(180deg, #fef3c7 0%, #fcd34d 45%, #d4af37 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                filter: 'drop-shadow(0 1px 8px rgba(212,175,55,0.25))',
              }}
            >
              {t('Place {{rank}}', { rank })}
            </span>
          </div>
          <h2 className='mt-1 text-base font-semibold text-amber-100/80'>
            {t('Congratulations, you won!')}
          </h2>
          <p className='mt-2 text-[11px] tabular-nums text-amber-200/55'>
            {card.activity.draw_date} · {pad(card.activity.slot_hour)}:{pad(card.activity.slot_minute)}
          </p>
        </motion.div>

        {/* Ornament divider — fine hairline + diamond */}
        <div className='flex w-full items-center gap-3 px-2'>
          <div className='h-px flex-1 bg-gradient-to-r from-transparent to-amber-300/35' />
          <div className='flex items-center gap-1.5'>
            <div className='size-1 rotate-45 bg-amber-300/50' />
            <div className='size-1.5 rotate-45 bg-amber-300/70' />
            <div className='size-1 rotate-45 bg-amber-300/50' />
          </div>
          <div className='h-px flex-1 bg-gradient-to-l from-transparent to-amber-300/35' />
        </div>

        {/* Prize amount — hero number with gold gradient */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className='text-center'
        >
          <p className='text-[10px] font-medium uppercase tracking-[0.32em] text-amber-200/55'>
            {t('Prize Amount')}
          </p>
          <p
            className='mt-2 text-[2.75rem] font-bold leading-none tracking-tight tabular-nums sm:text-5xl'
            style={{
              background:
                'linear-gradient(180deg, #fef9c3 0%, #fcd34d 35%, #d4af37 95%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: 'drop-shadow(0 3px 10px rgba(212,175,55,0.32))',
            }}
          >
            {formatQuota(winnerQuota)}
          </p>
        </motion.div>

        {/* Redemption code — gold-edged glass panel */}
        <div className='w-full'>
          <p className='mb-2 text-center text-[10px] font-medium uppercase tracking-[0.32em] text-amber-200/55'>
            {t('Redemption Code')}
          </p>
          <div
            className='rounded-xl p-3'
            style={{
              background:
                'linear-gradient(180deg, rgba(212,175,55,0.07), rgba(212,175,55,0.02))',
              boxShadow:
                'inset 0 0 0 1px rgba(212,175,55,0.28), inset 0 1px 0 rgba(255,235,180,0.06)',
            }}
          >
            <p className='select-all break-all font-mono text-xs font-semibold leading-relaxed text-amber-100/90'>
              {winnerCode}
            </p>
            <motion.button
              type='button'
              whileTap={{ scale: 0.97 }}
              onClick={handleCopy}
              className='mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-amber-950 transition-all'
              style={{
                background:
                  'linear-gradient(180deg, #fde68a 0%, #fcd34d 50%, #d4af37 100%)',
                boxShadow:
                  '0 6px 14px -4px rgba(212,175,55,0.55), inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(120,80,15,0.35)',
              }}
            >
              <AnimatePresence mode='wait'>
                {copied ? (
                  <motion.span
                    key='d'
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className='flex items-center gap-1.5'
                  >
                    <Check className='size-3.5' />
                    {t('Copied')}
                  </motion.span>
                ) : (
                  <motion.span
                    key='c'
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className='flex items-center gap-1.5'
                  >
                    <Copy className='size-3.5' />
                    {t('Copy Code')}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </div>
          <p className='mt-3 text-center text-[11px] leading-relaxed text-amber-200/45'>
            {t('Go to Wallet → Redemption Code, enter the code above to receive your credit')}
          </p>
        </div>
      </div>
    </div>
  )
}

// Moonlight + silver-leaf "dignified consolation" aesthetic — same dark obsidian
// world as WinnerCard, but cool-toned and slower-paced to match the gentler emotion.
function LoserCard({ card, onClose }: { card: LuckyBagResultCard; onClose: () => void }) {
  const { t } = useTranslation()

  // Drifting silver motes — slow downward fade (opposite of winner's rising sparkle).
  const motes = [
    { x: '12%', y: '18%', size: 2, delay: 0.2, duration: 3.8, drift: -6 },
    { x: '88%', y: '14%', size: 3, delay: 0.9, duration: 4.2, drift: 5 },
    { x: '6%', y: '60%', size: 2, delay: 1.6, duration: 3.6, drift: -4 },
    { x: '94%', y: '64%', size: 2, delay: 0.5, duration: 4.0, drift: 7 },
    { x: '50%', y: '90%', size: 2, delay: 2.0, duration: 4.4, drift: 0 },
  ]

  return (
    <div
      className='relative overflow-hidden rounded-2xl'
      style={{
        background:
          'linear-gradient(180deg, #1a1d22 0%, #11141a 55%, #0a0c10 100%)',
        boxShadow:
          '0 30px 60px -15px rgba(0,0,0,0.6), 0 0 0 1px rgba(196,202,214,0.16), inset 0 1px 0 rgba(220,225,235,0.08)',
      }}
    >
      {/* Cool moonlight spotlight from above */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(ellipse 100% 50% at 50% -10%, rgba(180,195,220,0.18), transparent 60%)',
        }}
      />
      {/* Floor vignette */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 bottom-0 h-2/5'
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.35), transparent)',
        }}
      />
      {/* Top silver hairline */}
      <div className='pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-300/55 to-transparent' />
      {/* Bottom silver hairline */}
      <div className='pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-slate-300/25 to-transparent' />

      {/* Slow horizontal shimmer — even gentler than winner's */}
      <motion.div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'linear-gradient(105deg, transparent 40%, rgba(220,225,235,0.05) 50%, transparent 60%)',
        }}
        animate={{ x: ['-100%', '200%'] }}
        transition={{ repeat: Infinity, duration: 6, ease: 'linear', repeatDelay: 3 }}
      />

      {/* Drifting silver motes — like dust in moonlight */}
      {motes.map((m, i) => (
        <motion.div
          key={i}
          aria-hidden
          className='pointer-events-none absolute rounded-full'
          style={{
            left: m.x,
            top: m.y,
            width: m.size,
            height: m.size,
            background:
              'radial-gradient(circle, rgba(220,225,235,0.75), rgba(220,225,235,0))',
          }}
          animate={{
            opacity: [0, 0.65, 0],
            y: [0, 14, 28],
            x: [0, m.drift, m.drift * 1.4],
          }}
          transition={{
            duration: m.duration,
            delay: m.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}

      {/* Close — silver-tinted to harmonize */}
      <button
        type='button'
        onClick={onClose}
        className='absolute right-3 top-3 z-20 flex size-7 cursor-pointer items-center justify-center rounded-full text-slate-300/40 transition-colors hover:bg-slate-300/10 hover:text-slate-100'
        aria-label='Close'
      >
        <X className='size-3.5' />
      </button>

      <div className='relative z-10 flex flex-col items-center gap-5 px-6 pb-6 pt-9'>
        {/* Lunar medallion — silver conic ring around obsidian disc */}
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className='relative'
        >
          <div
            className='flex size-[5.25rem] items-center justify-center rounded-full'
            style={{
              background:
                'conic-gradient(from 200deg, #c7cbd1, #e8eaed, #94a3b8, #dde0e5, #c7cbd1)',
              padding: '1.5px',
              boxShadow:
                '0 8px 24px -6px rgba(180,195,220,0.32), 0 0 0 1px rgba(180,195,220,0.25)',
            }}
          >
            <div
              className='flex size-full items-center justify-center rounded-full'
              style={{
                background:
                  'radial-gradient(circle at 32% 24%, #1d2128 0%, #0a0c0f 80%)',
                boxShadow:
                  'inset 0 1px 0 rgba(220,225,235,0.15), inset 0 -3px 10px rgba(0,0,0,0.55)',
              }}
            >
              {/* Hourglass that flips slowly — "time will come again" metaphor */}
              <motion.div
                animate={{ rotate: [0, 0, 180, 180, 360] }}
                transition={{
                  duration: 9,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  times: [0, 0.42, 0.5, 0.92, 1],
                }}
              >
                <Hourglass
                  className='size-8'
                  style={{
                    color: '#dce1e8',
                    filter: 'drop-shadow(0 2px 4px rgba(180,195,220,0.4))',
                  }}
                />
              </motion.div>
            </div>
          </div>
        </motion.div>

        {/* Title block — same hierarchy as WinnerCard for symmetry */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className='text-center'
        >
          <p className='text-[10px] font-medium uppercase tracking-[0.32em] text-slate-300/60'>
            {t('Draw Notice')}
          </p>
          <h2
            className='mt-2 text-xl font-semibold leading-tight tracking-tight sm:text-2xl'
            style={{
              background:
                'linear-gradient(180deg, #f1f3f7 0%, #c7cbd1 50%, #94a3b8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {t("Sorry, you didn't win this time")}
          </h2>
          <p className='mt-2 text-[11px] tabular-nums text-slate-300/50'>
            {card.activity.draw_date} · {pad(card.activity.slot_hour)}:{pad(card.activity.slot_minute)}
          </p>
        </motion.div>

        {/* Silver ornament divider — matches winner's diamond pattern */}
        <div className='flex w-full items-center gap-3 px-2'>
          <div className='h-px flex-1 bg-gradient-to-r from-transparent to-slate-300/30' />
          <div className='flex items-center gap-1.5'>
            <div className='size-1 rotate-45 bg-slate-300/40' />
            <div className='size-1.5 rotate-45 bg-slate-300/60' />
            <div className='size-1 rotate-45 bg-slate-300/40' />
          </div>
          <div className='h-px flex-1 bg-gradient-to-l from-transparent to-slate-300/30' />
        </div>

        {/* Encouragement — gentle, not patronizing */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className='text-center text-sm leading-relaxed text-slate-200/70'
        >
          {t('Remember to enter earlier next time, good luck!')}
        </motion.p>

        {/* Silver pill button — mirrors winner's gold pill */}
        <motion.button
          type='button'
          whileTap={{ scale: 0.98 }}
          onClick={onClose}
          className='w-full cursor-pointer rounded-lg py-2.5 text-sm font-semibold text-slate-900 transition-all'
          style={{
            background:
              'linear-gradient(180deg, #f1f3f7 0%, #c7cbd1 55%, #94a3b8 100%)',
            boxShadow:
              '0 6px 14px -4px rgba(148,163,184,0.45), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(50,60,75,0.25)',
          }}
        >
          {t('Got it')}
        </motion.button>
      </div>
    </div>
  )
}

function ResultDialog({
  card,
  open,
  onClose,
}: {
  card: LuckyBagResultCard | null
  open: boolean
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      {open && card && (
        <>
          <motion.div
            key='backdrop'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className='fixed inset-0 z-50 bg-black/30 backdrop-blur-md'
            onClick={onClose}
          />
          <motion.div
            key='dialog'
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className='fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 px-4'
          >
            {card.is_winner ? (
              <WinnerCard card={card} onClose={onClose} />
            ) : (
              <LoserCard card={card} onClose={onClose} />
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── Rules Card — understated page note ─────────────────────────────────────
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
  const summary = t('{{count}} draws per day — {{slots}}', {
    count: slots.length,
    slots: slots.map((s) => `${pad(s.hour)}:${pad(s.minute)}`).join(' · '),
  })

  return (
    <div className='relative flex items-center justify-center gap-3 py-0 text-center'>
      <div className='hidden h-px flex-1 bg-gradient-to-r from-transparent via-amber-400/25 to-transparent sm:block' />
      <p className='inline-flex max-w-full items-center justify-center gap-1.5 text-[11px] leading-5 text-zinc-500'>
        <PartyPopper className='size-3 shrink-0 text-amber-300/80' />
        <span className='truncate'>{summary}</span>
        <span className='hidden text-zinc-700 sm:inline'>·</span>
        <span className='hidden sm:inline'>{t('One ticket per draw · Free to enter')}</span>
      </p>
      <div className='hidden h-px flex-1 bg-gradient-to-r from-transparent via-amber-400/25 to-transparent sm:block' />
    </div>
  )
}

// ─── History (Right column) ───────────────────────────────────────────────────
// Activity archive panel with subtle emphasis for personal wins and compact pagination.
// ─── WinnerRow — one winner within a HistoryItem ────────────────────────────
function WinnerRow({
  name,
  quota,
  code,
  codeStatus,
  isMe,
  placeLabel,
  visual,
}: {
  name: string
  quota: number
  code: string
  codeStatus?: number
  isMe: boolean
  placeLabel: string
  visual: ReturnType<typeof getRowStyle>
}) {
  const { t } = useTranslation()
  const display = splitWinnerDisplayName(name)
  const [copied, setCopied] = useState(false)
  const isUsed = codeStatus === 3

  const handleCopy = async () => {
    await copyToClipboard(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn('flex items-start gap-2 py-1', isMe && 'rounded-xl px-1.5 bg-amber-300/5')}>
      <span className='mt-0.5 shrink-0 text-[9px] font-bold text-zinc-500 w-4 text-center'>{placeLabel}</span>
      <div
        className='flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white'
        style={{ background: visual.chip }}
      >
        {getAvatarInitial(display.name)}
      </div>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5'>
          <span className={cn('truncate text-[11px] font-semibold', isMe ? 'text-amber-100' : 'text-zinc-100')}>
            {display.name || t('Anonymous')}
          </span>
          {display.uid && <span className='text-[9px] tabular-nums text-zinc-500'>UID {display.uid}</span>}
          {isMe && (
            <span className='shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-emerald-300'>
              {t('You')}
            </span>
          )}
        </div>
        {isMe && code && (
          <div className='mt-1 flex flex-wrap items-center gap-1.5'>
            <code className='select-all rounded-full border border-white/8 bg-black/30 px-2 py-0.5 font-mono text-[9px] font-semibold tracking-[0.1em] text-amber-100/85'>
              {code}
            </code>
            <span className={cn('rounded-full px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.18em]', isUsed ? 'bg-white/6 text-zinc-500' : 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-300')}>
              {isUsed ? t('Used') : t('Unused')}
            </span>
            {!isUsed && (
              <button type='button' onClick={handleCopy} className='flex cursor-pointer items-center gap-1 rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[9px] text-zinc-400 transition-colors hover:text-amber-100'>
                {copied ? <><Check className='size-3' />{t('Copied')}</> : <><Copy className='size-3' />{t('Copy')}</>}
              </button>
            )}
          </div>
        )}
      </div>
      <div className='shrink-0 text-right'>
        <span className='block text-[11px] font-semibold tabular-nums text-amber-200'>{formatQuota(quota)}</span>
        <span className='block text-[8px] uppercase tracking-[0.18em] text-zinc-500'>quota</span>
      </div>
    </div>
  )
}

// ─── HistoryItem — single row in the winners list ───────────────────────────
function HistoryItem({ activity, rank }: { activity: LuckyBagActivity; rank: number }) {
  const { t } = useTranslation()
  const myRank = activity.my_winner_rank ?? 0
  const isMyWin = myRank > 0
  const visual = getRowStyle(rank - 1)

  const winners = [
    { name: activity.winner_name, quota: activity.winner_quota, code: activity.winner_code, codeStatus: activity.winner_code_status, rank: 1 },
    { name: activity.winner2_name, quota: activity.winner2_quota, code: activity.winner2_code, codeStatus: activity.winner2_code_status, rank: 2 },
    { name: activity.winner3_name, quota: activity.winner3_quota, code: activity.winner3_code, codeStatus: activity.winner3_code_status, rank: 3 },
  ].filter(w => w.name)

  const placeLabels = ['🥇', '🥈', '🥉']

  return (
    <div
      className={cn(
        'group relative rounded-2xl border px-2.5 py-1.5 transition-colors sm:px-3',
        isMyWin
          ? 'border-amber-300/20 bg-gradient-to-r from-amber-300/10 via-white/[0.03] to-transparent'
          : 'border-white/6 bg-white/[0.03] hover:bg-white/[0.05]',
      )}
      style={{
        boxShadow: isMyWin
          ? `inset 0 0 0 1px rgba(217,174,69,0.12), 0 8px 24px -18px ${visual.glow}`
          : 'inset 0 0 0 1px rgba(255,255,255,0.02)',
      }}
    >
      <div className='mb-1 flex items-center justify-between'>
        <p className='truncate text-[9px] tabular-nums text-zinc-500'>
          <span>{activity.draw_date}</span>
          <span className='mx-1 text-zinc-600'>·</span>
          <span>{pad(activity.slot_hour)}:{pad(activity.slot_minute)}</span>
        </p>
        <span className='text-[9px] text-zinc-600'>#{rank}</span>
      </div>
      {winners.length === 0 ? (
        <p className='text-[10px] text-zinc-500 px-1'>{t('No entries')}</p>
      ) : (
        <div className='divide-y divide-white/5'>
          {winners.map((w, i) => (
            <WinnerRow
              key={w.rank}
              name={w.name}
              quota={w.quota}
              code={w.code}
              codeStatus={w.codeStatus}
              isMe={myRank === w.rank}
              placeLabel={placeLabels[i] ?? `${i + 1}`}
              visual={getRowStyle(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── HistoryWinnersList — clean list with a quiet header and pagination ────
function HistoryWinnersList({
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
  const pageSize = HISTORY_PAGE_SIZE
  const totalPages = Math.ceil(total / pageSize)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
      className='relative flex h-full flex-col overflow-hidden rounded-[24px] border border-[#5f4d21]/60 bg-[#111019]/95 p-2.5 shadow-[0_28px_70px_-36px_rgba(0,0,0,0.85)] sm:p-3'
      style={{
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.05), 0 30px 72px -36px rgba(0,0,0,0.86)',
      }}
    >
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(circle at 100% 0%, rgba(217,174,69,0.11), transparent 38%), radial-gradient(circle at 0% 100%, rgba(124,58,237,0.12), transparent 46%)',
        }}
      />
      <div className='relative flex items-center justify-between gap-2 pb-2'>
        <div className='flex min-w-0 flex-1 items-center gap-2.5'>
          <div className='flex size-7 shrink-0 items-center justify-center rounded-lg border border-amber-400/25 bg-amber-400/10 text-amber-300'>
            <Trophy className='size-3.5' strokeWidth={2.2} />
          </div>
          <div className='min-w-0'>
            <div className='flex items-center gap-3'>
              <h3 className='shrink-0 text-xs font-semibold tracking-[0.14em] text-amber-200'>
                {t('Winning Records')}
              </h3>
              <div className='h-px w-12 bg-gradient-to-r from-amber-400/45 to-transparent' />
            </div>
            <p className='text-[9px] text-zinc-500'>
              {t('Recent draws · Anonymous winners')}
            </p>
          </div>
        </div>
        {total > 0 && (
          <span className='shrink-0 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-200'>
            {total}
          </span>
        )}
      </div>

      <div className='relative min-h-0 flex-1 overflow-y-auto'>
        {loading ? (
          <div className='space-y-1.5'>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className='h-[40px] w-full rounded-2xl bg-white/8' />
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className='flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 rounded-[22px] border border-white/8 bg-white/[0.025] py-8 text-center'>
            <div className='flex size-12 items-center justify-center rounded-full border border-white/8 bg-white/[0.04]'>
              <Gift className='size-5 text-zinc-500' />
            </div>
            <p className='text-sm text-zinc-500'>{t('No history yet')}</p>
          </div>
        ) : (
          <ul className='space-y-1.5'>
            {activities.map((a, idx) => (
              <li key={a.id}>
                <HistoryItem activity={a} rank={(page - 1) * pageSize + idx + 1} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {total > 0 && (
        <div className='relative mt-2 flex items-center justify-between gap-2 border-t border-white/8 pt-2'>
          <span className='text-[10px] tabular-nums text-zinc-500'>
            {t('{{from}}–{{to}} of {{total}}', {
              from: (page - 1) * pageSize + 1,
              to: Math.min(page * pageSize, total),
              total,
            })}
          </span>
          <div className='flex items-center gap-1'>
            <Button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              variant='outline'
              size='icon'
              className='size-6 rounded-full border-white/10 bg-white/[0.03] text-zinc-400 hover:border-amber-300/35 hover:bg-amber-300/10 hover:text-amber-200 disabled:opacity-35'
            >
              <ChevronLeft className='size-3.5' />
            </Button>
            <span className='min-w-[2.3rem] text-center text-[10px] font-semibold tabular-nums text-amber-200'>
              {page} / {Math.max(totalPages, 1)}
            </span>
            <Button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              variant='outline'
              size='icon'
              className='size-6 rounded-full border-white/10 bg-white/[0.03] text-zinc-400 hover:border-amber-300/35 hover:bg-amber-300/10 hover:text-amber-200 disabled:opacity-35'
            >
              <ChevronRight className='size-3.5' />
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  )
}

// ─── Dev-only Debug Panel ─────────────────────────────────────────────────────
// Tree-shaken in production: `import.meta.env.DEV` is statically replaced with
// `false` by Vite during build, so the entire panel is removed from the bundle.
function DebugPanel({
  statusData,
  onShowWinner,
  onShowLoser,
  onShowWinnerDirect,
  onShowLoserDirect,
  onSetAvailable,
  onSetEntered,
  onSetEntering,
  onSetLocked,
  onSetTodayFinished,
  onSetNextDrawn,
  onSetHistorySamples,
  onSetHistoryMany,
  onSetHistoryEmpty,
  onSetHistoryLoading,
  onRefetchStatus,
  onClearViewed,
  onShowWinnerRank2,
  onShowWinnerRank3,
  onSetHistoryThreeWinners,
  onSetResultCardRank2,
  onSetResultCardRank3,
}: {
  statusData: LuckyBagStatusResponse | null
  onShowWinner: () => void
  onShowLoser: () => void
  onShowWinnerDirect: () => void
  onShowLoserDirect: () => void
  onSetAvailable: () => void
  onSetEntered: () => void
  onSetEntering: () => void
  onSetLocked: () => void
  onSetTodayFinished: () => void
  onSetNextDrawn: () => void
  onSetHistorySamples: () => void
  onSetHistoryMany: () => void
  onSetHistoryEmpty: () => void
  onSetHistoryLoading: () => void
  onRefetchStatus: () => void
  onClearViewed: () => void
  onShowWinnerRank2: () => void
  onShowWinnerRank3: () => void
  onSetHistoryThreeWinners: () => void
  onSetResultCardRank2: () => void
  onSetResultCardRank3: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const groups = [
    {
      title: '开奖流程',
      buttons: [
        { label: '中奖：福袋动画后弹窗', onClick: onShowWinner },
        { label: '未中奖：福袋动画后弹窗', onClick: onShowLoser },
        { label: '直接显示中奖弹窗', onClick: onShowWinnerDirect },
        { label: '直接显示未中奖弹窗', onClick: onShowLoserDirect },
        { label: '直接显示第2名弹窗', onClick: onShowWinnerRank2 },
        { label: '直接显示第3名弹窗', onClick: onShowWinnerRank3 },
      ],
    },
    {
      title: '报名按钮状态',
      buttons: [
        { label: '未报名：可参与', onClick: onSetAvailable },
        { label: '已报名：等待开奖', onClick: onSetEntered },
        { label: '报名中', onClick: onSetEntering },
        { label: '即将开奖锁定', onClick: onSetLocked },
        { label: '今日已结束', onClick: onSetTodayFinished },
        { label: '下一场已开奖', onClick: onSetNextDrawn },
      ],
    },
    {
      title: '右侧开奖记录',
      buttons: [
        { label: '显示示例记录', onClick: onSetHistorySamples },
        { label: '很多中奖记录分页', onClick: onSetHistoryMany },
        { label: '显示空记录', onClick: onSetHistoryEmpty },
        { label: '显示加载状态', onClick: onSetHistoryLoading },
      ],
    },
    {
      title: '多名中奖展示',
      buttons: [
        { label: '开奖记录：1/2/3名全部展示', onClick: onSetHistoryThreeWinners },
        { label: '结果卡：我是第2名', onClick: onSetResultCardRank2 },
        { label: '结果卡：我是第3名', onClick: onSetResultCardRank3 },
      ],
    },
    {
      title: '数据恢复',
      buttons: [
        { label: '清除已查看标记', onClick: onClearViewed },
        { label: '重新拉取真实数据', onClick: onRefetchStatus },
      ],
    },
  ]

  if (!expanded) {
    return (
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='fixed bottom-3 left-3 z-40 h-8 border-white/10 bg-[#111019]/90 px-3 text-xs text-zinc-300 shadow-2xl backdrop-blur hover:bg-white/[0.06]'
        onClick={() => setExpanded(true)}
      >
        打开测试面板
      </Button>
    )
  }

  return (
    <div className='fixed bottom-3 left-3 z-40 flex max-h-[min(34rem,calc(100vh-1.5rem))] max-w-[min(38rem,calc(100vw-1.5rem))] flex-col gap-2 overflow-y-auto rounded-2xl border border-white/8 bg-[#111019]/90 p-3 shadow-2xl backdrop-blur'>
      <div className='flex items-center gap-2'>
        <Bug className='size-3.5 text-zinc-500' />
        <p className='text-[10px] font-semibold uppercase tracking-wider text-zinc-500'>
          测试面板 · 仅开发环境
        </p>
        <span className='ml-auto text-[10px] tabular-nums text-zinc-500'>
          entered={String(statusData?.entered ?? false)} · finished=
          {String(statusData?.today_finished ?? false)} · locked=
          {String(statusData?.next_locked ?? false)}
        </span>
        <button
          type='button'
          className='ml-2 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
          onClick={() => setExpanded(false)}
        >
          收起
        </button>
      </div>
      {groups.map((group) => (
        <div key={group.title} className='space-y-1.5 rounded-xl border border-white/6 bg-white/[0.025] p-2'>
          <p className='text-[10px] font-semibold text-amber-200/70'>{group.title}</p>
          <div className='flex flex-wrap gap-1.5'>
            {group.buttons.map((b) => (
              <Button
                key={b.label}
                variant='outline'
                size='sm'
                className='h-7 border-white/10 bg-white/[0.03] px-2.5 text-xs text-zinc-300 hover:bg-white/[0.06]'
                onClick={b.onClick}
              >
                {b.label}
              </Button>
            ))}
          </div>
        </div>
      ))}
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
  const [debugHistoryDataset, setDebugHistoryDataset] = useState<LuckyBagActivity[] | null>(null)

  const [dialogCard, setDialogCard] = useState<LuckyBagResultCard | null>(null)
  const [drawAnimationPhase, setDrawAnimationPhase] = useState<DrawAnimationPhase>('idle')
  const drawAnimationTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearDrawAnimationTimers = useCallback(() => {
    drawAnimationTimersRef.current.forEach((timer) => clearTimeout(timer))
    drawAnimationTimersRef.current = []
  }, [])

  const revealResultAfterBagAnimation = useCallback(
    (card: LuckyBagResultCard) => {
      clearDrawAnimationTimers()
      setDialogCard(null)
      setDrawAnimationPhase('shaking')

      const openingTimer = setTimeout(() => {
        setDrawAnimationPhase('opening')
      }, 900)
      const revealTimer = setTimeout(() => {
        setDrawAnimationPhase('idle')
        setDialogCard(card)
        drawAnimationTimersRef.current = []
      }, 1500)

      drawAnimationTimersRef.current = [openingTimer, revealTimer]
    },
    [clearDrawAnimationTimers],
  )

  useEffect(() => {
    return clearDrawAnimationTimers
  }, [clearDrawAnimationTimers])

  const fetchStatus = useCallback(async (autoPopDialog = false) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[LuckyBag] fetchStatus called', { autoPopDialog })
    }
    try {
      const res = await getLuckyBagStatus()
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log('[LuckyBag] fetchStatus response', {
          success: res.success,
          entered: res.data?.entered,
          nextActivity: res.data?.next_activity
            ? `id=${res.data.next_activity.id} ${res.data.next_activity.draw_date} ${pad(res.data.next_activity.slot_hour)}:${pad(res.data.next_activity.slot_minute)} status=${res.data.next_activity.status}`
            : null,
          resultCards: res.data?.result_cards?.map(
            (c) => `id=${c.activity.id} winner=${c.is_winner} viewed=${c.winner_viewed} status=${c.activity.status}`,
          ),
          drawSlots: res.data?.draw_slots,
        })
      }
      if (res.success && res.data) {
        setStatusData(res.data)
        setEntered(res.data.entered)
        if (autoPopDialog) {
          const today = new Date().toISOString().slice(0, 10)
          const todayCard = (res.data.result_cards ?? []).find(
            (c) => c.activity.draw_date === today && !c.winner_viewed,
          )
          if (todayCard) setDialogCard(todayCard)
        }
      }
    } catch (e) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error('[LuckyBag] fetchStatus error', e)
      }
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
    if (debugHistoryDataset) {
      const start = (page - 1) * HISTORY_PAGE_SIZE
      setHistoryActivities(debugHistoryDataset.slice(start, start + HISTORY_PAGE_SIZE))
      setHistoryTotal(debugHistoryDataset.length)
      setHistoryLoading(false)
      return
    }
    fetchHistory(page)
  }

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
          if (!best || s.hour * 60 + s.minute > best.hour * 60 + best.minute) {
            best = { hour: s.hour, minute: s.minute }
          }
        }
      }
      return best
    })()
    const check = async () => {
      attempts += 1
      try {
        const res = await getLuckyBagStatus()
        if (res.success && res.data) {
          setStatusData(res.data)
          setEntered(res.data.entered)
          const today = new Date().toISOString().slice(0, 10)
          const latest =
            lastPassed &&
            (res.data.today_activities ?? []).find(
              (a) => a.draw_date === today && a.slot_hour === lastPassed.hour && a.slot_minute === lastPassed.minute,
            )
          if (latest && latest.status === 'drawn') {
            const card = (res.data.result_cards ?? []).find(
              (c) =>
                c.activity.draw_date === today &&
                c.activity.slot_hour === lastPassed!.hour &&
                c.activity.slot_minute === lastPassed!.minute &&
                !c.winner_viewed,
            )
            if (card) revealResultAfterBagAnimation(card)
            fetchHistory(1)
            return
          }
        }
      } catch {
        // retry
      }
      if (attempts < maxAttempts) {
        setTimeout(check, 3000)
      }
    }
    setTimeout(check, 500)
  }, [fetchHistory, revealResultAfterBagAnimation, statusData?.draw_slots])

  // Synthesize a fake card for debug-only previewing of dialogs.
  const buildDebugCard = useCallback(
    (isWinner: boolean): LuckyBagResultCard => {
      const real = statusData?.today_activities?.[0]
      const today = new Date().toISOString().slice(0, 10)
      return {
        activity: buildDebugActivity({
          id: real?.id ?? -1,
          draw_date: real?.draw_date ?? today,
          slot_hour: real?.slot_hour ?? 12,
          slot_minute: real?.slot_minute ?? 0,
          status: 'drawn',
          winner_user_id: 1,
          winner_name: isWinner ? '你' : '测试用户（UID 42）',
          winner_quota: 5_000_000,
          winner_code: 'DEBUG-FAKE-CODE-XXXX-XXXX-XXXX-XXXX',
          drawn_at: Math.floor(Date.now() / 1000),
        }),
        is_winner: isWinner,
        winner_viewed: false,
      }
    },
    [statusData],
  )

  const applyDebugStatus = useCallback(
    ({
      enteredValue,
      enteringValue = false,
      todayFinished = false,
      nextLocked = false,
      nextDrawn = false,
    }: {
      enteredValue: boolean
      enteringValue?: boolean
      todayFinished?: boolean
      nextLocked?: boolean
      nextDrawn?: boolean
    }) => {
      clearDrawAnimationTimers()
      setDialogCard(null)
      setDrawAnimationPhase('idle')
      setEntering(enteringValue)
      setEntered(enteredValue)
      setDebugHistoryDataset(null)

      const today = new Date().toISOString().slice(0, 10)
      const activities = [
        buildDebugActivity({
          id: -101,
          draw_date: today,
          slot_hour: 9,
          slot_minute: 0,
          status: 'drawn',
          winner_name: '陈测试（UID 1001）',
          winner_quota: 880_000,
          winner_code: 'DEBUG-HISTORY-0900',
          winner_code_status: 0,
          drawn_at: Math.floor(Date.now() / 1000) - 3600,
        }),
        buildDebugActivity({
          id: -102,
          draw_date: today,
          slot_hour: 12,
          slot_minute: 0,
          status: nextDrawn ? 'drawn' : 'pending',
          winner_name: nextDrawn ? '你' : '',
          winner_quota: nextDrawn ? 5_000_000 : 0,
          winner_code: nextDrawn ? 'DEBUG-NEXT-DRAWN' : '',
          winner_code_status: nextDrawn ? 1 : 0,
          drawn_at: nextDrawn ? Math.floor(Date.now() / 1000) : 0,
        }),
        buildDebugActivity({
          id: -103,
          draw_date: today,
          slot_hour: 17,
          slot_minute: 0,
          status: 'pending',
        }),
      ]

      setStatusData({
        today_activities: activities,
        next_activity: todayFinished ? null : activities[1],
        entered: enteredValue,
        weight: enteredValue ? 1 : 0,
        participant_count: enteredValue ? 1289 : 1288,
        result_cards: nextDrawn
          ? [
              {
                activity: activities[1],
                is_winner: true,
                winner_viewed: false,
              },
            ]
          : [],
        draw_slots: [
          { hour: 9, minute: 0 },
          { hour: 12, minute: 0 },
          { hour: 17, minute: 0 },
        ],
        today_finished: todayFinished,
        next_locked: nextLocked,
      })
    },
    [clearDrawAnimationTimers],
  )

  const applyDebugHistorySamples = useCallback(() => {
    setDebugHistoryDataset(null)
    setHistoryLoading(false)
    setHistoryPage(1)
    setHistoryTotal(10)
    setHistoryActivities(
      Array.from({ length: 10 }).map((_, index) =>
        buildDebugActivity({
          id: -300 - index,
          slot_hour: [9, 12, 17][index % 3],
          slot_minute: 0,
          status: 'drawn',
          winner_user_id: index + 1,
          winner_name:
            index === 1
              ? '你'
              : ['赵一（UID 1001）', '钱二（UID 1002）', '孙三（UID 1003）', '李四（UID 1004）'][
                  index % 4
                ],
          winner_quota: [880_000, 1_880_000, 5_000_000, 660_000][index % 4],
          winner_code: `DEBUG-CODE-${String(index + 1).padStart(2, '0')}`,
          winner_code_status: index === 1 ? 1 : 0,
          drawn_at: Math.floor(Date.now() / 1000) - index * 1800,
        }),
      ),
    )
  }, [])

  const buildDebugHistoryRecords = useCallback((count: number) => {
    const names = [
      '赵一（UID 1001）',
      '钱二（UID 1002）',
      '孙三（UID 1003）',
      '李四（UID 1004）',
      '周五（UID 1005）',
      '吴六（UID 1006）',
      '郑七（UID 1007）',
      '王八（UID 1008）',
    ]
    const quotas = [660_000, 880_000, 1_280_000, 1_880_000, 2_880_000, 5_000_000]
    const slots = [
      { hour: 9, minute: 0 },
      { hour: 12, minute: 0 },
      { hour: 17, minute: 0 },
    ]

    return Array.from({ length: count }).map((_, index) => {
      const slot = slots[index % slots.length]

      return buildDebugActivity({
        id: -500 - index,
        slot_hour: slot.hour,
        slot_minute: slot.minute,
        status: 'drawn',
        winner_user_id: index + 1,
        winner_name: index === 7 ? '你' : names[index % names.length],
        winner_quota: quotas[index % quotas.length],
        winner_code: `DEBUG-MANY-${String(index + 1).padStart(3, '0')}`,
        winner_code_status: index === 7 ? 1 : 0,
        drawn_at: Math.floor(Date.now() / 1000) - index * 1800,
      })
    })
  }, [])

  const applyDebugHistoryMany = useCallback(() => {
    const records = buildDebugHistoryRecords(37)
    setDebugHistoryDataset(records)
    setHistoryLoading(false)
    setHistoryPage(1)
    setHistoryTotal(records.length)
    setHistoryActivities(records.slice(0, HISTORY_PAGE_SIZE))
  }, [buildDebugHistoryRecords])

  const debugHandlers = useMemo(
    () => ({
      showWinner: () => revealResultAfterBagAnimation(buildDebugCard(true)),
      showLoser: () => revealResultAfterBagAnimation(buildDebugCard(false)),
      showWinnerDirect: () => setDialogCard(buildDebugCard(true)),
      showLoserDirect: () => setDialogCard(buildDebugCard(false)),
      setAvailable: () => applyDebugStatus({ enteredValue: false }),
      setEntered: () => applyDebugStatus({ enteredValue: true }),
      setEntering: () => applyDebugStatus({ enteredValue: false, enteringValue: true }),
      setLocked: () => applyDebugStatus({ enteredValue: false, nextLocked: true }),
      setTodayFinished: () => applyDebugStatus({ enteredValue: false, todayFinished: true }),
      setNextDrawn: () => applyDebugStatus({ enteredValue: false, nextDrawn: true }),
      setHistorySamples: applyDebugHistorySamples,
      setHistoryMany: applyDebugHistoryMany,
      setHistoryEmpty: () => {
        setDebugHistoryDataset(null)
        setHistoryLoading(false)
        setHistoryPage(1)
        setHistoryTotal(0)
        setHistoryActivities([])
      },
      setHistoryLoading: () => {
        setDebugHistoryDataset(null)
        setHistoryActivities([])
        setHistoryTotal(0)
        setHistoryLoading(true)
      },
      refetch: () => {
        setDebugHistoryDataset(null)
        setEntering(false)
        setHistoryLoading(false)
        fetchStatus(true)
        fetchHistory(1)
      },
      clearViewed: () => {
        setStatusData((prev) =>
          prev
            ? {
                ...prev,
                result_cards:
                  prev.result_cards?.map((c) => ({ ...c, winner_viewed: false })) ?? null,
              }
            : prev,
        )
      },
      // 第2/3名中奖弹窗
      showWinnerRank2: () => {
        const today = new Date().toISOString().slice(0, 10)
        setDialogCard({
          activity: buildDebugActivity({
            status: 'drawn',
            draw_date: today,
            winner_user_id: 99,
            winner_name: '🥇 赵一（UID 99）',
            winner_quota: 5_000_000,
            winner_code: 'DEBUG-RANK1-CODE-XXXX',
            winner2_user_id: 1,
            winner2_name: '你',
            winner2_quota: 3_000_000,
            winner2_code: 'DEBUG-RANK2-CODE-XXXX',
            winner3_user_id: 88,
            winner3_name: '🥉 王三（UID 88）',
            winner3_quota: 1_500_000,
            winner3_code: 'DEBUG-RANK3-CODE-XXXX',
            drawn_at: Math.floor(Date.now() / 1000),
          }),
          is_winner: true,
          winner_rank: 2,
          winner_viewed: false,
        })
      },
      showWinnerRank3: () => {
        const today = new Date().toISOString().slice(0, 10)
        setDialogCard({
          activity: buildDebugActivity({
            status: 'drawn',
            draw_date: today,
            winner_user_id: 99,
            winner_name: '🥇 赵一（UID 99）',
            winner_quota: 5_000_000,
            winner_code: 'DEBUG-RANK1-CODE-XXXX',
            winner2_user_id: 88,
            winner2_name: '🥈 李二（UID 88）',
            winner2_quota: 3_000_000,
            winner2_code: 'DEBUG-RANK2-CODE-XXXX',
            winner3_user_id: 1,
            winner3_name: '你',
            winner3_quota: 1_500_000,
            winner3_code: 'DEBUG-RANK3-CODE-XXXX',
            drawn_at: Math.floor(Date.now() / 1000),
          }),
          is_winner: true,
          winner_rank: 3,
          winner_viewed: false,
        })
      },
      // 开奖记录：1/2/3名全部展示
      setHistoryThreeWinners: () => {
        const today = new Date().toISOString().slice(0, 10)
        setDebugHistoryDataset(null)
        setHistoryLoading(false)
        setHistoryPage(1)
        setHistoryTotal(3)
        setHistoryActivities([
          buildDebugActivity({
            id: -901,
            draw_date: today,
            slot_hour: 9,
            slot_minute: 0,
            status: 'drawn',
            winner_user_id: 1,
            winner_name: '你',
            winner_quota: 5_000_000,
            winner_code: 'DEBUG-3W-RANK1',
            winner_code_status: 1,
            winner2_user_id: 42,
            winner2_name: '李**（UID 42）',
            winner2_quota: 3_000_000,
            winner2_code: 'DEBUG-3W-RANK2',
            winner3_user_id: 88,
            winner3_name: '王**（UID 88）',
            winner3_quota: 1_500_000,
            winner3_code: 'DEBUG-3W-RANK3',
            my_winner_rank: 1,
            drawn_at: Math.floor(Date.now() / 1000) - 3600,
          }),
          buildDebugActivity({
            id: -902,
            draw_date: today,
            slot_hour: 12,
            slot_minute: 0,
            status: 'drawn',
            winner_user_id: 55,
            winner_name: '张**（UID 55）',
            winner_quota: 5_000_000,
            winner_code: 'DEBUG-3W2-RANK1',
            winner2_user_id: 1,
            winner2_name: '你',
            winner2_quota: 3_000_000,
            winner2_code: 'DEBUG-3W2-RANK2',
            winner2_code_status: 1,
            winner3_user_id: 66,
            winner3_name: '陈**（UID 66）',
            winner3_quota: 1_500_000,
            winner3_code: 'DEBUG-3W2-RANK3',
            my_winner_rank: 2,
            drawn_at: Math.floor(Date.now() / 1000) - 1800,
          }),
          buildDebugActivity({
            id: -903,
            draw_date: today,
            slot_hour: 17,
            slot_minute: 0,
            status: 'drawn',
            winner_user_id: 77,
            winner_name: '孙**（UID 77）',
            winner_quota: 5_000_000,
            winner_code: 'DEBUG-3W3-RANK1',
            winner2_user_id: 88,
            winner2_name: '周**（UID 88）',
            winner2_quota: 3_000_000,
            winner2_code: 'DEBUG-3W3-RANK2',
            winner3_user_id: 99,
            winner3_name: '吴**（UID 99）',
            winner3_quota: 1_500_000,
            winner3_code: 'DEBUG-3W3-RANK3',
            my_winner_rank: 0,
            drawn_at: Math.floor(Date.now() / 1000) - 600,
          }),
        ])
      },
      // 结果卡：我中了第2/3名
      setResultCardRank2: () => {
        const today = new Date().toISOString().slice(0, 10)
        const activity = buildDebugActivity({
          id: -910,
          draw_date: today,
          slot_hour: 12,
          slot_minute: 0,
          status: 'drawn',
          winner_user_id: 55,
          winner_name: '张**（UID 55）',
          winner_quota: 5_000_000,
          winner_code: 'DEBUG-RC2-RANK1',
          winner2_user_id: 1,
          winner2_name: '你',
          winner2_quota: 3_000_000,
          winner2_code: 'DEBUG-RC2-MY-CODE',
          winner2_code_status: 1,
          winner3_user_id: 88,
          winner3_name: '王**（UID 88）',
          winner3_quota: 1_500_000,
          winner3_code: 'DEBUG-RC2-RANK3',
          my_winner_rank: 2,
          drawn_at: Math.floor(Date.now() / 1000),
        })
        setStatusData((prev) =>
          prev
            ? {
                ...prev,
                result_cards: [{ activity, is_winner: true, winner_rank: 2, winner_viewed: false }],
              }
            : prev,
        )
      },
      setResultCardRank3: () => {
        const today = new Date().toISOString().slice(0, 10)
        const activity = buildDebugActivity({
          id: -911,
          draw_date: today,
          slot_hour: 17,
          slot_minute: 0,
          status: 'drawn',
          winner_user_id: 55,
          winner_name: '张**（UID 55）',
          winner_quota: 5_000_000,
          winner_code: 'DEBUG-RC3-RANK1',
          winner2_user_id: 42,
          winner2_name: '李**（UID 42）',
          winner2_quota: 3_000_000,
          winner2_code: 'DEBUG-RC3-RANK2',
          winner3_user_id: 1,
          winner3_name: '你',
          winner3_quota: 1_500_000,
          winner3_code: 'DEBUG-RC3-MY-CODE',
          winner3_code_status: 1,
          my_winner_rank: 3,
          drawn_at: Math.floor(Date.now() / 1000),
        })
        setStatusData((prev) =>
          prev
            ? {
                ...prev,
                result_cards: [{ activity, is_winner: true, winner_rank: 3, winner_viewed: false }],
              }
            : prev,
        )
      },
    }),
    [
      applyDebugHistoryMany,
      applyDebugHistorySamples,
      applyDebugStatus,
      buildDebugCard,
      fetchHistory,
      fetchStatus,
      revealResultAfterBagAnimation,
      setDialogCard,
      setStatusData,
      setDebugHistoryDataset,
      setHistoryLoading,
      setHistoryPage,
      setHistoryTotal,
      setHistoryActivities,
    ],
  )

  return (
    <>
      <ResultDialog
        card={dialogCard}
        open={dialogCard !== null}
        onClose={() => {
          if (dialogCard && dialogCard.activity.id > 0) {
            markLuckyBagViewed(dialogCard.activity.id).catch(() => {})
          }
          setDialogCard(null)
        }}
      />
      <div className='relative isolate h-full min-h-0 overflow-y-auto overflow-x-hidden bg-[#09070f] text-zinc-100'>
        <div aria-hidden className='absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(217,174,69,0.08),transparent_28%),radial-gradient(circle_at_10%_15%,rgba(124,58,237,0.14),transparent_22%),radial-gradient(circle_at_90%_22%,rgba(34,211,238,0.08),transparent_22%),linear-gradient(180deg,#0b0812_0%,#09070f_44%,#08070d_100%)]' />
        <div aria-hidden className='pointer-events-none absolute inset-0 overflow-hidden opacity-90'>
          {PAGE_STARS.map((star, index) => {
            const driftX = ((index % 5) - 2) * (2.6 + (index % 3))
            const driftY = (((index + 2) % 5) - 2) * (2.2 + (index % 4) * 0.7)
            const glow = star.size >= 3.5 ? 0.72 : star.size <= 1.2 ? 0.34 : 0.48

            return (
              <motion.span
                key={`${star.left}-${star.top}`}
                className='absolute rounded-full bg-white'
                style={{
                  left: star.left,
                  top: star.top,
                  width: star.size,
                  height: star.size,
                  opacity: star.opacity,
                  boxShadow: `0 0 ${star.size * 5.2}px rgba(255,255,255,${glow})`,
                }}
                animate={{
                  opacity: [star.opacity * 0.22, star.opacity, star.opacity * 0.5, star.opacity * 0.85],
                  scale: [0.72, 1.28, 0.88, 1.08],
                  x: [0, driftX, -driftX * 0.45, 0],
                  y: [0, driftY, -driftY * 0.4, 0],
                }}
                transition={{
                  duration: 3.2 + (index % 7) * 0.42,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: star.delay,
                }}
              />
            )
          })}
        </div>

        <div className='relative mx-auto flex min-h-full w-full max-w-[1240px] flex-col justify-center gap-4 px-3 pb-2.5 pt-5 sm:px-4 sm:pt-7 lg:px-5 lg:pb-3 lg:pt-8'>
          <div className='flex justify-center pb-1.5 text-center'>
            <p
              className='bg-[linear-gradient(90deg,rgba(251,191,36,0.76)_0%,#fde68a_28%,#fff7cc_50%,#fde68a_72%,rgba(251,191,36,0.76)_100%)] bg-clip-text text-[clamp(1.18rem,2.5vw,2.05rem)] font-semibold leading-none text-transparent drop-shadow-[0_2px_14px_rgba(217,174,69,0.22)]'
              style={{
                fontFamily:
                  '"Songti SC", "STKaiti", "Kaiti SC", "KaiTi", "FZKai-Z03", serif',
              }}
            >
              {t('Every win is a gift from fate')}
            </p>
          </div>

          <div className='grid items-stretch gap-2.5 lg:grid-cols-[minmax(0,0.98fr)_minmax(300px,0.68fr)]'>
            {statusLoading ? (
              <div className='flex flex-col gap-2.5'>
                <div className='rounded-[26px] border border-white/8 bg-white/[0.03] p-2.5 sm:p-3'>
                  <div className='flex h-full flex-col gap-2'>
                    <Skeleton className='h-8 w-full rounded-2xl bg-white/8' />
                    <Skeleton className='mt-1 h-[16rem] w-full rounded-full bg-white/8' />
                    <Skeleton className='h-10 w-full rounded-full bg-white/8' />
                  </div>
                </div>
                <Skeleton className='h-[7.5rem] w-full rounded-[24px] bg-white/8' />
              </div>
            ) : (
              <div className='flex flex-col gap-2.5'>
                <ActivityCard
                  statusData={statusData}
                  entered={entered}
                  participantCount={statusData?.participant_count ?? 0}
                  onEnter={handleEnter}
                  entering={entering}
                  drawAnimationPhase={drawAnimationPhase}
                />
                <DrawStatusPanel
                  statusData={statusData}
                  onDrawTime={handleDrawTime}
                />
              </div>
            )}

            <div className='relative'>
              <div className='absolute inset-0'>
                <HistoryWinnersList
                  activities={historyActivities}
                  loading={historyLoading}
                  total={historyTotal}
                  page={historyPage}
                  onPageChange={handlePageChange}
                />
              </div>
            </div>
          </div>

          <RulesCard drawSlots={statusData?.draw_slots} />

          {import.meta.env.DEV && (
            <DebugPanel
              statusData={statusData}
              onShowWinner={debugHandlers.showWinner}
              onShowLoser={debugHandlers.showLoser}
              onShowWinnerDirect={debugHandlers.showWinnerDirect}
              onShowLoserDirect={debugHandlers.showLoserDirect}
              onSetAvailable={debugHandlers.setAvailable}
              onSetEntered={debugHandlers.setEntered}
              onSetEntering={debugHandlers.setEntering}
              onSetLocked={debugHandlers.setLocked}
              onSetTodayFinished={debugHandlers.setTodayFinished}
              onSetNextDrawn={debugHandlers.setNextDrawn}
              onSetHistorySamples={debugHandlers.setHistorySamples}
              onSetHistoryMany={debugHandlers.setHistoryMany}
              onSetHistoryEmpty={debugHandlers.setHistoryEmpty}
              onSetHistoryLoading={debugHandlers.setHistoryLoading}
              onRefetchStatus={debugHandlers.refetch}
              onClearViewed={debugHandlers.clearViewed}
              onShowWinnerRank2={debugHandlers.showWinnerRank2}
              onShowWinnerRank3={debugHandlers.showWinnerRank3}
              onSetHistoryThreeWinners={debugHandlers.setHistoryThreeWinners}
              onSetResultCardRank2={debugHandlers.setResultCardRank2}
              onSetResultCardRank3={debugHandlers.setResultCardRank3}
            />
          )}
        </div>
      </div>
    </>
  )
}
