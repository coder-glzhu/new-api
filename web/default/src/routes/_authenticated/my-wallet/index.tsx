import { createFileRoute } from '@tanstack/react-router'
import { MyWallet } from '@/features/my-wallet'

export const Route = createFileRoute('/_authenticated/my-wallet/')({
  component: MyWallet,
})
