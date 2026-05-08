import { z } from 'zod'
import type { TFunction } from 'i18next'
import type { PlanPayload, SubscriptionPlan } from '../types'

// 简化版套餐表单：只包含自己新面板用得到的字段。
// 第三方支付相关字段（stripe_price_id / creem_product_id / price_cny）
// 在新面板中不展示，编辑已有套餐时在 payload 里原样透传，避免被清空。
export function getPlanCreateFormSchema(t: TFunction) {
  return z.object({
    title: z.string().min(1, t('Please enter plan title')),
    subtitle: z.string().optional(),
    price_amount: z.coerce.number().min(0, t('Please enter amount')),
    duration_unit: z.enum(['year', 'month', 'day', 'hour', 'custom']),
    duration_value: z.coerce.number().min(1),
    custom_seconds: z.coerce.number().min(0).optional(),
    quota_reset_period: z.enum([
      'never',
      'daily',
      'weekly',
      'monthly',
      'custom',
    ]),
    quota_reset_custom_seconds: z.coerce.number().min(0).optional(),
    enabled: z.boolean(),
    sort_order: z.coerce.number(),
    max_purchase_per_user: z.coerce.number().min(0),
    upgrade_group: z.string().optional(),
    starts_at: z.coerce.number().min(0).optional(),
    expires_at: z.coerce.number().min(0).optional(),
  })
}

export type PlanCreateFormValues = z.infer<
  ReturnType<typeof getPlanCreateFormSchema>
>

export const PLAN_CREATE_FORM_DEFAULTS: PlanCreateFormValues = {
  title: '',
  subtitle: '',
  price_amount: 0,
  duration_unit: 'month',
  duration_value: 1,
  custom_seconds: 0,
  quota_reset_period: 'never',
  quota_reset_custom_seconds: 0,
  enabled: true,
  sort_order: 0,
  max_purchase_per_user: 0,
  upgrade_group: '',
  starts_at: 0,
  expires_at: 0,
}

export function planToCreateFormValues(
  plan: SubscriptionPlan
): PlanCreateFormValues {
  return {
    title: plan.title || '',
    subtitle: plan.subtitle || '',
    price_amount: Number(plan.price_amount || 0),
    duration_unit: plan.duration_unit || 'month',
    duration_value: Number(plan.duration_value || 1),
    custom_seconds: Number(plan.custom_seconds || 0),
    quota_reset_period: plan.quota_reset_period || 'never',
    quota_reset_custom_seconds: Number(plan.quota_reset_custom_seconds || 0),
    enabled: plan.enabled !== false,
    sort_order: Number(plan.sort_order || 0),
    max_purchase_per_user: Number(plan.max_purchase_per_user || 0),
    upgrade_group: plan.upgrade_group || '',
    starts_at: Number(plan.starts_at || 0),
    expires_at: Number(plan.expires_at || 0),
  }
}

// USD -> quota 折算：total_amount = price_amount × quotaPerUnit。
// price_amount 为 0（免费套餐）时 total_amount 置 0（表示"无限/免费"由上层判断）。
export function createFormValuesToPayload(
  values: PlanCreateFormValues,
  quotaPerUnit: number,
  existing?: SubscriptionPlan
): PlanPayload {
  const price = Number(values.price_amount || 0)
  const perUnit = quotaPerUnit > 0 ? quotaPerUnit : 500000
  const totalAmount = Math.round(price * perUnit)

  return {
    plan: {
      // 保留 existing 里新面板不涉及的字段（第三方支付 ID、人民币价格）
      stripe_price_id: existing?.stripe_price_id ?? '',
      creem_product_id: existing?.creem_product_id ?? '',
      price_cny: existing?.price_cny ?? 0,
      // 新面板管理的字段
      title: values.title,
      subtitle: values.subtitle || '',
      price_amount: price,
      currency: 'USD',
      duration_unit: values.duration_unit,
      duration_value: Number(values.duration_value || 0),
      custom_seconds: Number(values.custom_seconds || 0),
      quota_reset_period: values.quota_reset_period,
      quota_reset_custom_seconds:
        values.quota_reset_period === 'custom'
          ? Number(values.quota_reset_custom_seconds || 0)
          : 0,
      enabled: values.enabled,
      sort_order: Number(values.sort_order || 0),
      max_purchase_per_user: Number(values.max_purchase_per_user || 0),
      total_amount: totalAmount,
      upgrade_group: values.upgrade_group || '',
      starts_at: Number(values.starts_at || 0),
      expires_at: Number(values.expires_at || 0),
    },
  }
}
