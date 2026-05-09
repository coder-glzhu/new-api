import { SettingsPage } from '@/features/system-settings/components/settings-page'
import {
  CUSTOM_INTEGRATIONS_DEFAULT_SECTION,
  getCustomIntegrationsSectionContent,
} from './section-registry'
import type { CustomIntegrationSettings } from './types'

const defaultSettings: CustomIntegrationSettings = {
  WechatBotEnabled: false,
  WechatBotUserId: '',
  WechatBotGroupIds: '',
  WechatBotReminderContent: '',
  WechatBotResultContent: '',
}

export function CustomIntegrationsSettings() {
  return (
    <SettingsPage
      routePath='/_authenticated/system-settings/custom-integrations/$section'
      defaultSettings={defaultSettings}
      defaultSection={CUSTOM_INTEGRATIONS_DEFAULT_SECTION}
      getSectionContent={getCustomIntegrationsSectionContent}
    />
  )
}
