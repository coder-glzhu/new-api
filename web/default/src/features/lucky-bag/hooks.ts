import { useEffect, useRef, useState } from 'react'
import type { DrawSlot } from './types'

const DEFAULT_DRAW_SLOTS: DrawSlot[] = [
  { hour: 9, minute: 0 },
  { hour: 12, minute: 0 },
  { hour: 17, minute: 0 },
]

const slotKey = (s: DrawSlot) => s.hour * 60 + s.minute

// 返回距下一场开奖的剩余时间和下一场的 hour/minute
// drawSlots: 后端 status 接口返回的 draw_slots；默认 [{9,0},{12,0},{17,0}]
// onDrawTime: 每当倒计时跨越一个开奖时刻时触发（可用于主动拉取最新开奖结果）
export function useNextDrawCountdown(
  drawSlots: DrawSlot[] | undefined,
  onDrawTime?: () => void
) {
  const slots = drawSlots && drawSlots.length > 0 ? drawSlots : DEFAULT_DRAW_SLOTS

  const calc = () => {
    const now = new Date()
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()

    for (const slot of slots) {
      const drawSec = slot.hour * 3600 + slot.minute * 60
      if (nowSec < drawSec) {
        const diff = drawSec - nowSec
        return {
          hour: slot.hour,
          minute: slot.minute,
          h: Math.floor(diff / 3600),
          m: Math.floor((diff % 3600) / 60),
          s: diff % 60,
          diff,
        }
      }
    }
    const first = slots[0]
    const tomorrowFirst = first.hour * 3600 + first.minute * 60
    const secondsInDay = 24 * 3600
    const diff = secondsInDay - nowSec + tomorrowFirst
    return {
      hour: first.hour,
      minute: first.minute,
      h: Math.floor(diff / 3600),
      m: Math.floor((diff % 3600) / 60),
      s: diff % 60,
      diff,
    }
  }

  const [state, setState] = useState(calc)
  const prevKeyRef = useRef(slotKey({ hour: state.hour, minute: state.minute }))
  const onDrawTimeRef = useRef(onDrawTime)
  onDrawTimeRef.current = onDrawTime
  const slotsKey = slots.map(slotKey).join(',')

  useEffect(() => {
    const next = calc()
    setState(next)
    prevKeyRef.current = slotKey(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsKey])

  useEffect(() => {
    const id = setInterval(() => {
      const next = calc()
      setState(next)
      const nextKey = slotKey(next)
      if (nextKey !== prevKeyRef.current) {
        onDrawTimeRef.current?.()
      }
      prevKeyRef.current = nextKey
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsKey])

  return state
}
