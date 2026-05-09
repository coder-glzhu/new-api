import { useEffect, useRef, useState } from 'react'

const DRAW_HOURS = [9, 12, 17]

// 返回距下一场开奖的剩余秒数和下一场的小时
// onDrawTime: 每当倒计时跨越一个开奖时刻时触发（可用于主动拉取最新开奖结果）
export function useNextDrawCountdown(onDrawTime?: () => void) {
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
  // 用"上一次的 diff 秒数"来判断：diff 从 >0 变成 diff 很大（跳到下一天）或从小变大
  // 更可靠的方案：记录上一次 nextHour 和对应日期，只有同一天内 hour 变化才触发
  const prevNextHourRef = useRef(state.hour)
  const prevDiffRef = useRef(state.diff)
  const onDrawTimeRef = useRef(onDrawTime)
  onDrawTimeRef.current = onDrawTime

  useEffect(() => {
    const id = setInterval(() => {
      const next = calc()
      setState(next)
      const prevHour = prevNextHourRef.current
      const prevDiff = prevDiffRef.current
      // 只有当倒计时真正归零跨越（diff 从接近0变大，且 hour 变化）才触发
      // 排除跨天：跨天时 diff 会从很小的数跳到很大的数（> 3600）
      if (next.hour !== prevHour && prevDiff <= 60 && next.diff > prevDiff) {
        onDrawTimeRef.current?.()
      }
      prevNextHourRef.current = next.hour
      prevDiffRef.current = next.diff
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return state
}
