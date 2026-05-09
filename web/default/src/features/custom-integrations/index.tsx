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
  LuckyBagDrawHours: '9,12,17',
  LuckyBagMinUsd: '1',
  LuckyBagMaxUsd: '10',
  HupijiaoPrice: 7.3,
  HupijiaoAmountOptions: '[]',
  HupijiaoAmountDiscount: '{}',
  HupijiaoEnabled: false,
  HupijiaoAppId: '',
  HupijiaoAppSecret: '',
  HupijiaoApiUrl: 'https://api.xunhupay.com/payment/do.html',
  HupijiaoNotifyUrl: '',
  HupijiaoReturnUrl: '',
  HupijiaoMinTopUp: 1,
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
