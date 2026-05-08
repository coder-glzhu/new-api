import { useState, useEffect } from 'react'

export function useCountdown(targetUnix: number): number {
  const [remaining, setRemaining] = useState(() =>
    targetUnix > 0 ? targetUnix - Math.floor(Date.now() / 1000) : 0
  )
  useEffect(() => {
    if (targetUnix <= 0) return
    const tick = () => setRemaining(targetUnix - Math.floor(Date.now() / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetUnix])
  return remaining
}
