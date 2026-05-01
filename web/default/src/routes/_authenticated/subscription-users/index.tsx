import z from 'zod'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { ROLE } from '@/lib/roles'
import { SubscriptionUsers } from '@/features/subscription-users'

const subscriptionUsersSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(20),
  filter: z.string().optional().catch(''),
  status: z
    .enum(['all', 'active', 'expired', 'cancelled'])
    .optional()
    .catch('all'),
  planId: z.number().optional().catch(0),
})

export const Route = createFileRoute('/_authenticated/subscription-users/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }
  },
  validateSearch: subscriptionUsersSearchSchema,
  component: SubscriptionUsers,
})
