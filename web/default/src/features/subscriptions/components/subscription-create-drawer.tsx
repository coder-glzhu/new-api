import { useEffect, useMemo, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  CalendarClock,
  Coins,
  RefreshCw,
  Sparkles,
  Tag,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatQuota } from '@/lib/format'
import { useSystemConfigStore } from '@/stores/system-config-store'
import { DateTimePicker } from '@/components/datetime-picker'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { createPlan, getGroups, updatePlan } from '../api'
import { getDurationUnitOptions, getResetPeriodOptions } from '../constants'
import {
  getPlanCreateFormSchema,
  PLAN_CREATE_FORM_DEFAULTS,
  planToCreateFormValues,
  createFormValuesToPayload,
  type PlanCreateFormValues,
} from '../lib'
import type { PlanRecord } from '../types'
import { useSubscriptions } from './subscriptions-provider'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: PlanRecord
}

export function SubscriptionCreateDrawer({
  open,
  onOpenChange,
  currentRow,
}: Props) {
  const { t } = useTranslation()
  const isEdit = !!currentRow?.plan?.id
  const { triggerRefresh } = useSubscriptions()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [groupOptions, setGroupOptions] = useState<string[]>([])

  const quotaPerUnit = useSystemConfigStore(
    (s) => s.config.currency.quotaPerUnit || 500000
  )

  const schema = getPlanCreateFormSchema(t)
  const form = useForm<PlanCreateFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<PlanCreateFormValues>,
    defaultValues: PLAN_CREATE_FORM_DEFAULTS,
  })

  useEffect(() => {
    if (open) {
      if (currentRow?.plan) {
        form.reset(planToCreateFormValues(currentRow.plan))
      } else {
        form.reset(PLAN_CREATE_FORM_DEFAULTS)
      }
      getGroups()
        .then((res) => {
          if (res.success) setGroupOptions(res.data || [])
        })
        .catch(() => {})
    }
  }, [open, currentRow, form])

  const durationUnit = form.watch('duration_unit')
  const resetPeriod = form.watch('quota_reset_period')
  const usdQuotaAmount = form.watch('price_amount')
  const startsAt = form.watch('starts_at')
  const expiresAt = form.watch('expires_at')

  // 美元 × quotaPerUnit 自动折算的预览值
  const autoTotalQuota = useMemo(() => {
    const v = Number(usdQuotaAmount || 0)
    return Math.round(v * quotaPerUnit)
  }, [usdQuotaAmount, quotaPerUnit])

  // 日期选择的最小可选日期（今天零点）
  const todayStart = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  // 结束时间的最小日期：若设置了开始时间，则不能早于开始日期；否则不早于今天
  const endMinDate = useMemo(() => {
    if (startsAt && startsAt > 0) {
      const d = new Date(startsAt * 1000)
      d.setHours(0, 0, 0, 0)
      return d > todayStart ? d : todayStart
    }
    return todayStart
  }, [startsAt, todayStart])

  const onSubmit = async (values: PlanCreateFormValues) => {
    // 促销窗口校验：结束时间必须晚于开始时间（两者都设置的情况下）
    if (
      values.starts_at &&
      values.expires_at &&
      values.expires_at <= values.starts_at
    ) {
      toast.error(t('Sale end time must be later than start time'))
      return
    }

    setIsSubmitting(true)
    try {
      const payload = createFormValuesToPayload(
        values,
        quotaPerUnit,
        currentRow?.plan
      )
      if (isEdit && currentRow?.plan?.id) {
        const res = await updatePlan(currentRow.plan.id, payload)
        if (res.success) {
          toast.success(t('Update succeeded'))
          onOpenChange(false)
          triggerRefresh()
        }
      } else {
        const res = await createPlan(payload)
        if (res.success) {
          toast.success(t('Create succeeded'))
          onOpenChange(false)
          triggerRefresh()
        }
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const durationUnitOpts = getDurationUnitOptions(t)
  const resetPeriodOpts = getResetPeriodOptions(t)

  // 促销窗口状态提示
  const saleWindowHint = useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    const s = Number(startsAt || 0)
    const e = Number(expiresAt || 0)
    if (!s && !e) return t('On sale immediately, never expires')
    if (s && !e) {
      if (s <= now) return t('Already on sale, never expires')
      return t('Scheduled to go on sale')
    }
    if (!s && e) {
      if (e <= now) return t('Sale window has ended')
      return t('On sale now, will end at end time')
    }
    if (e <= s) return t('Sale end time must be later than start time')
    if (e <= now) return t('Sale window has ended')
    if (s > now) return t('Scheduled sale window')
    return t('On sale now, ends at end time')
  }, [startsAt, expiresAt, t])

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) form.reset()
      }}
    >
      <SheetContent className='flex h-dvh w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[620px]'>
        <SheetHeader className='border-b px-4 py-3 text-start sm:px-6 sm:py-4'>
          <SheetTitle>
            {isEdit ? t('Update plan info') : t('Create new subscription plan')}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? t('Modify existing subscription plan configuration')
              : t(
                  'Fill in the following info to create a new subscription plan'
                )}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            id='subscription-create-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex-1 space-y-5 overflow-y-auto px-3 py-4 sm:space-y-6 sm:px-5 sm:py-5'
          >
            {/* 基本信息 */}
            <section className='space-y-4'>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <Tag className='h-4 w-4' />
                {t('Basic Info')}
              </h3>

              <FormField
                control={form.control}
                name='title'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Plan Title')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('e.g. Basic Plan')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='subtitle'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Plan Subtitle')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t('e.g. Suitable for light usage')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='sort_order'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Sort Order')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value, 10) || 0)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='enabled'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center gap-2 pt-8'>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className='!mt-0'>
                        {t('Enabled Status')}
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>
            </section>

            {/* 价格与额度 */}
            <section className='space-y-4'>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <Coins className='h-4 w-4' />
                {t('Pricing & Quota')}
              </h3>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='price_amount'
                  render={({ field }) => (
                    <FormItem className='grid grid-rows-[1.25rem_auto_auto] gap-2'>
                      <FormLabel className='h-5 leading-5'>
                        {t('USD Quota Amount')}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          step='0.01'
                          min={0}
                          placeholder='0.00'
                          onChange={(e) =>
                            field.onChange(parseFloat(e.target.value) || 0)
                          }
                        />
                      </FormControl>
                      <FormDescription className='min-h-12 leading-6'>
                        {t(
                          'Enter the USD quota amount. Quota is auto-calculated by system rate.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='price_cny'
                  render={({ field }) => (
                    <FormItem className='grid grid-rows-[1.25rem_auto_auto] gap-2'>
                      <FormLabel className='h-5 leading-5'>
                        {t('Price (CNY)')}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          step='0.01'
                          min={0.01}
                          placeholder='0.00'
                          onChange={(e) =>
                            field.onChange(parseFloat(e.target.value) || 0)
                          }
                        />
                      </FormControl>
                      <FormDescription className='min-h-12 leading-6'>
                        {t(
                          'Used for CNY payment channels. Must be greater than 0.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='max_purchase_per_user'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Purchase Limit')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value, 10) || 0)
                          }
                        />
                      </FormControl>
                      <FormDescription>{t('0 means unlimited')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='bg-muted/40 rounded-md border border-dashed p-3 text-xs'>
                <div className='text-muted-foreground flex items-center justify-between gap-2'>
                  <span>{t('Auto-calculated Quota')}</span>
                  <span className='text-foreground font-medium tabular-nums'>
                    {formatQuota(autoTotalQuota)}
                  </span>
                </div>
                <div className='text-muted-foreground mt-1 flex items-center justify-between gap-2'>
                  <span>{t('Conversion rate')}</span>
                  <span className='tabular-nums'>
                    1 USD = {quotaPerUnit.toLocaleString()}
                  </span>
                </div>
              </div>

              <FormField
                control={form.control}
                name='upgrade_group'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Upgrade Group')}</FormLabel>
                    <Select
                      items={[
                        { value: '__none__', label: t('No Upgrade') },
                        ...groupOptions.map((g) => ({ value: g, label: g })),
                      ]}
                      onValueChange={(v) =>
                        field.onChange(v === '__none__' ? '' : v)
                      }
                      value={field.value || ''}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('No Upgrade')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          <SelectItem value='__none__'>
                            {t('No Upgrade')}
                          </SelectItem>
                          {groupOptions.map((g) => (
                            <SelectItem key={g} value={g}>
                              {g}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>

            {/* 有效期 */}
            <section className='space-y-4'>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <CalendarClock className='h-4 w-4' />
                {t('Duration Settings')}
              </h3>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='duration_unit'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Duration Unit')}</FormLabel>
                      <Select
                        items={durationUnitOpts.map((o) => ({
                          value: o.value,
                          label: o.label,
                        }))}
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {durationUnitOpts.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {durationUnit === 'custom' ? (
                  <FormField
                    control={form.control}
                    name='custom_seconds'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Custom Seconds')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type='number'
                            min={1}
                            onChange={(e) =>
                              field.onChange(parseInt(e.target.value, 10) || 0)
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={form.control}
                    name='duration_value'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Duration Value')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type='number'
                            min={1}
                            onChange={(e) =>
                              field.onChange(parseInt(e.target.value, 10) || 0)
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </section>

            {/* 额度重置 */}
            <section className='space-y-4'>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <RefreshCw className='h-4 w-4' />
                {t('Quota Reset')}
              </h3>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='quota_reset_period'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Reset Cycle')}</FormLabel>
                      <Select
                        items={resetPeriodOpts.map((o) => ({
                          value: o.value,
                          label: o.label,
                        }))}
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {resetPeriodOpts.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='quota_reset_custom_seconds'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Custom Seconds')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          disabled={resetPeriod !== 'custom'}
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value, 10) || 0)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </section>

            {/* 促销时段 */}
            <section className='space-y-4'>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <Sparkles className='h-4 w-4' />
                {t('Sale Window')}
              </h3>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='starts_at'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Sale Start Time')}</FormLabel>
                      <FormControl>
                        <DateTimePicker
                          value={
                            field.value && field.value > 0
                              ? new Date(field.value * 1000)
                              : undefined
                          }
                          onChange={(d) =>
                            field.onChange(
                              d ? Math.floor(d.getTime() / 1000) : 0
                            )
                          }
                          minDate={todayStart}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Leave empty to go on sale immediately')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='expires_at'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Sale End Time')}</FormLabel>
                      <FormControl>
                        <DateTimePicker
                          value={
                            field.value && field.value > 0
                              ? new Date(field.value * 1000)
                              : undefined
                          }
                          onChange={(d) =>
                            field.onChange(
                              d ? Math.floor(d.getTime() / 1000) : 0
                            )
                          }
                          minDate={endMinDate}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Leave empty to never expire')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='text-muted-foreground rounded-md border border-dashed bg-amber-50/40 px-3 py-2 text-xs dark:bg-amber-500/5'>
                {saleWindowHint}
              </div>
            </section>
          </form>
        </Form>

        <SheetFooter className='grid grid-cols-2 gap-2 border-t px-4 py-3 sm:flex sm:px-6 sm:py-4'>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button
            form='subscription-create-form'
            type='submit'
            disabled={isSubmitting}
          >
            {isSubmitting ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
