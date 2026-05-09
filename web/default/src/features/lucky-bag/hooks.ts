import { useEffect, useState } from 'react'

const DRAW_HOURS = [9, 12, 17]

// 返回距下一场开奖的剩余秒数和下一场的小时
export function useNextDrawCountdown() {
  const calc = () => {
    const now = new Date()
    const h = now.getHours()
    const m = now.getMinutes()
    const s = now.getSeconds()
    const nowSec = h * 3600 + m * 60 + s

    for (const dh of DRAW_HOURS) {
      const drawSec = dh * 3600
      if (nowSec < drawSec) {
        const diff = drawSec - nowSec
        return {
          hour: dh,
          h: Math.floor(diff / 3600),
          m: Math.floor((diff % 3600) / 60),
          s: diff % 60,
          diff,
        }
      }
    }
    // 今天所有场次已过，到明天第一场
    const tomorrowFirst = DRAW_HOURS[0] * 3600
    const secondsInDay = 24 * 3600
    const diff = secondsInDay - nowSec + tomorrowFirst
    return {
      hour: DRAW_HOURS[0],
      h: Math.floor(diff / 3600),
      m: Math.floor((diff % 3600) / 60),
      s: diff % 60,
      diff,
    }
  }

  const [state, setState] = useState(calc)

  useEffect(() => {
    const id = setInterval(() => setState(calc()), 1000)
    return () => clearInterval(id)
  }, [])

  return state
}
