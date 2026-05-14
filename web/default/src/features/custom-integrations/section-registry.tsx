import type { TFunction } from 'i18next'
import { createSectionRegistry } from '@/features/system-settings/utils/section-registry'
import { HupijiaoSettingsSection } from './hupijiao-settings-section'
import { InviteRewardsSection } from './invite-rewards-section'
import { LuckyBagSection } from './lucky-bag-section'
import { OpenAIStatusMonitorSection } from './openai-status-section'
import { WechatBotSection } from './wechat-bot-section'
import type { CustomIntegrationSettings } from './types'

function resolveAddonDefaults(
  settings: CustomIntegrationSettings
): CustomIntegrationSettings {
  return {
    WechatBotEnabled: settings.WechatBotEnabled ?? false,
    WechatBotUserId: settings.WechatBotUserId ?? '',
    WechatBotGroupIds: settings.WechatBotGroupIds ?? '',
    WechatBotReminderContent: settings.WechatBotReminderContent ?? '',
    WechatBotResultContent: settings.WechatBotResultContent ?? '',
    LuckyBagDrawHours: settings.LuckyBagDrawHours ?? '9,12,17',
    LuckyBagMinUsd: settings.LuckyBagMinUsd ?? '1',
    LuckyBagMaxUsd: settings.LuckyBagMaxUsd ?? '10',
    HupijiaoPrice: settings.HupijiaoPrice ?? 7.3,
    HupijiaoAmountOptions: settings.HupijiaoAmountOptions ?? '[]',
    HupijiaoAmountDiscount: settings.HupijiaoAmountDiscount ?? '{}',
    HupijiaoEnabled: settings.HupijiaoEnabled ?? false,
    HupijiaoAppId: settings.HupijiaoAppId ?? '',
    HupijiaoAppSecret: settings.HupijiaoAppSecret ?? '',
    HupijiaoApiUrl:
      settings.HupijiaoApiUrl ?? 'https://api.xunhupay.com/payment/do.html',
    HupijiaoNotifyUrl: settings.HupijiaoNotifyUrl ?? '',
    HupijiaoReturnUrl: settings.HupijiaoReturnUrl ?? '',
    HupijiaoMinTopUp: settings.HupijiaoMinTopUp ?? 1,
    HupijiaoInviteRewardRatio: settings.HupijiaoInviteRewardRatio ?? 0.2,
    OpenAIStatusMonitorEnabled: settings.OpenAIStatusMonitorEnabled ?? false,
  }
}

const CUSTOM_INTEGRATIONS_SECTIONS = [
  {
    id: 'wechat-bot',
    titleKey: 'WeChat Notifications',
    descriptionKey: 'Configure WeChat group draw reminders',
    build: (settings: CustomIntegrationSettings) => (
      <WechatBotSection defaultValues={resolveAddonDefaults(settings)} />
    ),
  },
  {
    id: 'lucky-bag',
    titleKey: 'Lucky Bag',
    descriptionKey: 'Configure lucky bag draw times',
    build: (settings: CustomIntegrationSettings) => (
      <LuckyBagSection defaultValues={resolveAddonDefaults(settings)} />
    ),
  },
  {
    id: 'hupijiao',
    titleKey: 'Hupijiao Gateway',
    descriptionKey: 'Configuration for Alipay payments through Hupijiao',
    build: (settings: CustomIntegrationSettings) => (
      <HupijiaoSettingsSection defaultValues={resolveAddonDefaults(settings)} />
    ),
  },
  {
    id: 'invite-rewards',
    titleKey: 'Invitation Rewards',
    descriptionKey: 'Configure rewards for invited users who pay through Hupijiao',
    build: (settings: CustomIntegrationSettings) => (
      <InviteRewardsSection defaultValues={resolveAddonDefaults(settings)} />
    ),
  },
  {
    id: 'openai-status',
    titleKey: 'OpenAI Status Monitor',
    descriptionKey: 'Push OpenAI upstream incidents to WeChat groups',
    build: (settings: CustomIntegrationSettings) => (
      <OpenAIStatusMonitorSection defaultValues={resolveAddonDefaults(settings)} />
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
