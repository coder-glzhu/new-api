import { createFileRoute, redirect } from '@tanstack/react-router'
import { CustomIntegrationsSettings } from '@/features/custom-integrations'
import {
  CUSTOM_INTEGRATIONS_DEFAULT_SECTION,
  CUSTOM_INTEGRATIONS_SECTION_IDS,
} from '@/features/custom-integrations/section-registry.tsx'

export const Route = createFileRoute(
  '/_authenticated/system-settings/custom-integrations/$section'
)({
  beforeLoad: ({ params }) => {
    const validSections = CUSTOM_INTEGRATIONS_SECTION_IDS as unknown as string[]
    if (!validSections.includes(params.section)) {
      throw redirect({
        to: '/system-settings/custom-integrations/$section',
        params: { section: CUSTOM_INTEGRATIONS_DEFAULT_SECTION },
      })
    }
  },
  component: CustomIntegrationsSettings,
})
