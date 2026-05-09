import { createFileRoute } from '@tanstack/react-router'
import { LuckyBag } from '@/features/lucky-bag'

export const Route = createFileRoute('/_authenticated/lucky-bag/')({
  component: LuckyBag,
})
