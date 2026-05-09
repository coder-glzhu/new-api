import { createFileRoute, redirect } from '@tanstack/react-router'
import { CUSTOM_INTEGRATIONS_DEFAULT_SECTION } from '@/features/custom-integrations/section-registry.tsx'

export const Route = createFileRoute(
  '/_authenticated/system-settings/custom-integrations/'
)({
  beforeLoad: () => {
    throw redirect({
      to: '/system-settings/custom-integrations/$section',
      params: { section: CUSTOM_INTEGRATIONS_DEFAULT_SECTION },
    })
  },
})
