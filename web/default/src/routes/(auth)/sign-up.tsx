import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { saveAffiliateCode } from '@/features/auth/lib/storage'
import { SignUp } from '@/features/auth/sign-up'

const searchSchema = z.object({
  aff: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/sign-up')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    if (search.aff) {
      saveAffiliateCode(search.aff)
    }
  },
  component: SignUp,
})
