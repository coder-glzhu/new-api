import type { TFunction } from 'i18next'
import { createSectionRegistry } from '@/features/system-settings/utils/section-registry'
import { WechatBotSection } from './wechat-bot-section'
import type { CustomIntegrationSettings } from './types'

const CUSTOM_INTEGRATIONS_SECTIONS = [
  {
    id: 'wechat-bot',
    titleKey: 'WeChat Notifications',
    descriptionKey: 'Configure WeChat group draw reminders',
    build: (settings: CustomIntegrationSettings) => (
      <WechatBotSection
        defaultValues={{
          WechatBotEnabled: settings.WechatBotEnabled ?? false,
          WechatBotUserId: settings.WechatBotUserId ?? '',
          WechatBotGroupIds: settings.WechatBotGroupIds ?? '',
          WechatBotReminderContent: settings.WechatBotReminderContent ?? '',
          WechatBotResultContent: settings.WechatBotResultContent ?? '',
        }}
      />
    ),
  },
] as const

export type CustomIntegrationSectionId =
  (typeof CUSTOM_INTEGRATIONS_SECTIONS)[number]['id']

const registry = createSectionRegistry<
  CustomIntegrationSectionId,
  CustomIntegrationSettings
>({
  sections: CUSTOM_INTEGRATIONS_SECTIONS,
  defaultSection: 'wechat-bot',
  basePath: '/system-settings/custom-integrations',
  urlStyle: 'path',
})

export const CUSTOM_INTEGRATIONS_SECTION_IDS = registry.sectionIds
export const CUSTOM_INTEGRATIONS_DEFAULT_SECTION = registry.defaultSection
export const getCustomIntegrationsSectionNavItems = (t: TFunction) =>
  registry.getSectionNavItems(t)
export const getCustomIntegrationsSectionContent =
  registry.getSectionContent
