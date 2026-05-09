import { useEffect, useState } from 'react'

// Returns HH, MM, SS until next noon (12:00:00 local time)
export function useNoonCountdown() {
  const getTimeLeft = () => {
    const now = new Date()
    const next = new Date(now)
    next.setHours(12, 0, 0, 0)
    if (now >= next) {
      next.setDate(next.getDate() + 1)
    }
    const diff = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000))
    const h = Math.floor(diff / 3600)
    const m = Math.floor((diff % 3600) / 60)
    const s = diff % 60
    return { h, m, s, diff }
  }

  const [timeLeft, setTimeLeft] = useState(getTimeLeft)

  useEffect(() => {
    const id = setInterval(() => setTimeLeft(getTimeLeft()), 1000)
    return () => clearInterval(id)
  }, [])

  return timeLeft
}
