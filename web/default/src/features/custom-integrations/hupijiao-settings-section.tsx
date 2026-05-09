import { useEffect, useMemo, useRef, useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Code2, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { useResetForm } from '@/features/system-settings/hooks/use-reset-form'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import { AmountDiscountVisualEditor } from '@/features/system-settings/integrations/amount-discount-visual-editor'
import { AmountOptionsVisualEditor } from '@/features/system-settings/integrations/amount-options-visual-editor'
import {
  formatJsonForEditor,
  getJsonError,
  normalizeJsonForComparison,
  removeTrailingSlash,
} from '@/features/system-settings/integrations/utils'
import type { CustomIntegrationSettings } from './types'

const schema = z.object({
  HupijiaoPrice: z.number().positive(),
  HupijiaoAmountOptions: z.string().superRefine((value, ctx) => {
    const error = getJsonError(value, (parsed) => Array.isArray(parsed))
    if (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: error })
    }
  }),
  HupijiaoAmountDiscount: z.string().superRefine((value, ctx) => {
    const error = getJsonError(
      value,
      (parsed) =>
        !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    )
    if (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: error })
    }
  }),
  HupijiaoEnabled: z.boolean(),
  HupijiaoAppId: z.string(),
  HupijiaoAppSecret: z.string(),
  HupijiaoApiUrl: z.string().refine((value) => {
    const trimmed = value.trim()
    if (!trimmed) return true
    return /^https?:\/\//.test(trimmed)
  }, 'Provide a valid URL starting with http:// or https://'),
  HupijiaoNotifyUrl: z.string().refine((value) => {
    const trimmed = value.trim()
    if (!trimmed) return true
    return /^https?:\/\//.test(trimmed)
  }, 'Provide a valid URL starting with http:// or https://'),
  HupijiaoReturnUrl: z.string().refine((value) => {
    const trimmed = value.trim()
    if (!trimmed) return true
    return /^https?:\/\//.test(trimmed)
  }, 'Provide a valid URL starting with http:// or https://'),
  HupijiaoMinTopUp: z.number().min(0),
})

type FormValues = z.infer<typeof schema>

type Props = {
  defaultValues: CustomIntegrationSettings
}

function buildFormDefaults(d: CustomIntegrationSettings): FormValues {
  return {
    HupijiaoPrice: d.HupijiaoPrice ?? 7.3,
    HupijiaoAmountOptions: formatJsonForEditor(
      d.HupijiaoAmountOptions ?? '[]'
    ),
    HupijiaoAmountDiscount: formatJsonForEditor(
      d.HupijiaoAmountDiscount ?? '{}'
    ),
    HupijiaoEnabled: d.HupijiaoEnabled ?? false,
    HupijiaoAppId: d.HupijiaoAppId ?? '',
    HupijiaoAppSecret: d.HupijiaoAppSecret ?? '',
    HupijiaoApiUrl:
      d.HupijiaoApiUrl ?? 'https://api.xunhupay.com/payment/do.html',
    HupijiaoNotifyUrl: d.HupijiaoNotifyUrl ?? '',
    HupijiaoReturnUrl: d.HupijiaoReturnUrl ?? '',
    HupijiaoMinTopUp: d.HupijiaoMinTopUp ?? 1,
  }
}

export function HupijiaoSettingsSection({ defaultValues }: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [amountOptionsVisualMode, setAmountOptionsVisualMode] = useState(true)
  const [amountDiscountVisualMode, setAmountDiscountVisualMode] =
    useState(true)

  const baselineRef = useRef<FormValues>(buildFormDefaults(defaultValues))

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  const defaultsSignature = JSON.stringify(formDefaults)
  useEffect(() => {
    baselineRef.current = JSON.parse(defaultsSignature) as FormValues
  }, [defaultsSignature])

  const saveHupijiaoPricing = async () => {
    const valid = await form.trigger([
      'HupijiaoPrice',
      'HupijiaoAmountOptions',
      'HupijiaoAmountDiscount',
    ])
    if (!valid) {
      toast.error(t('Please fix validation errors'))
      return
    }

    const values = form.getValues()
    const sanitized = {
      HupijiaoPrice: values.HupijiaoPrice,
      HupijiaoAmountOptions: values.HupijiaoAmountOptions.trim(),
      HupijiaoAmountDiscount: values.HupijiaoAmountDiscount.trim(),
    }

    const initial = {
      HupijiaoPrice: baselineRef.current.HupijiaoPrice,
      HupijiaoAmountOptions: baselineRef.current.HupijiaoAmountOptions.trim(),
      HupijiaoAmountDiscount:
        baselineRef.current.HupijiaoAmountDiscount.trim(),
    }

    const updates: Array<{ key: string; value: string | number }> = []

    if (sanitized.HupijiaoPrice !== initial.HupijiaoPrice) {
      updates.push({ key: 'HupijiaoPrice', value: sanitized.HupijiaoPrice })
    }

    if (
      normalizeJsonForComparison(sanitized.HupijiaoAmountOptions) !==
      normalizeJsonForComparison(initial.HupijiaoAmountOptions)
    ) {
      updates.push({
        key: 'HupijiaoAmountOptions',
        value: sanitized.HupijiaoAmountOptions,
      })
    }

    if (
      normalizeJsonForComparison(sanitized.HupijiaoAmountDiscount) !==
      normalizeJsonForComparison(initial.HupijiaoAmountDiscount)
    ) {
      updates.push({
        key: 'HupijiaoAmountDiscount',
        value: sanitized.HupijiaoAmountDiscount,
      })
    }

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }

    baselineRef.current = {
      ...baselineRef.current,
      HupijiaoPrice: sanitized.HupijiaoPrice,
      HupijiaoAmountOptions: sanitized.HupijiaoAmountOptions,
      HupijiaoAmountDiscount: sanitized.HupijiaoAmountDiscount,
    }
    toast.success(t('Saved successfully'))
  }

  const saveHupijiaoGateway = async () => {
    const valid = await form.trigger([
      'HupijiaoEnabled',
      'HupijiaoAppId',
      'HupijiaoAppSecret',
      'HupijiaoApiUrl',
      'HupijiaoNotifyUrl',
      'HupijiaoReturnUrl',
      'HupijiaoMinTopUp',
    ])
    if (!valid) {
      toast.error(t('Please fix validation errors'))
      return
    }

    const values = form.getValues()
    const sanitized = {
      HupijiaoEnabled: values.HupijiaoEnabled,
      HupijiaoAppId: values.HupijiaoAppId.trim(),
      HupijiaoAppSecret: values.HupijiaoAppSecret.trim(),
      HupijiaoApiUrl:
        removeTrailingSlash(values.HupijiaoApiUrl) ||
        'https://api.xunhupay.com/payment/do.html',
      HupijiaoNotifyUrl: removeTrailingSlash(values.HupijiaoNotifyUrl),
      HupijiaoReturnUrl: removeTrailingSlash(values.HupijiaoReturnUrl),
      HupijiaoMinTopUp: values.HupijiaoMinTopUp,
    }

    const initial = {
      HupijiaoEnabled: baselineRef.current.HupijiaoEnabled,
      HupijiaoAppId: baselineRef.current.HupijiaoAppId.trim(),
      HupijiaoAppSecret: baselineRef.current.HupijiaoAppSecret.trim(),
      HupijiaoApiUrl: removeTrailingSlash(baselineRef.current.HupijiaoApiUrl),
      HupijiaoNotifyUrl: removeTrailingSlash(
        baselineRef.current.HupijiaoNotifyUrl
      ),
      HupijiaoReturnUrl: removeTrailingSlash(
        baselineRef.current.HupijiaoReturnUrl
      ),
      HupijiaoMinTopUp: baselineRef.current.HupijiaoMinTopUp,
    }

    const updates: Array<{ key: string; value: string | number | boolean }> =
      []

    if (sanitized.HupijiaoEnabled !== initial.HupijiaoEnabled) {
      updates.push({
        key: 'HupijiaoEnabled',
        value: sanitized.HupijiaoEnabled,
      })
    }

    if (sanitized.HupijiaoAppId !== initial.HupijiaoAppId) {
      updates.push({ key: 'HupijiaoAppId', value: sanitized.HupijiaoAppId })
    }

    if (
      sanitized.HupijiaoAppSecret &&
      sanitized.HupijiaoAppSecret !== initial.HupijiaoAppSecret
    ) {
      updates.push({
        key: 'HupijiaoAppSecret',
        value: sanitized.HupijiaoAppSecret,
      })
    }

    if (sanitized.HupijiaoApiUrl !== initial.HupijiaoApiUrl) {
      updates.push({ key: 'HupijiaoApiUrl', value: sanitized.HupijiaoApiUrl })
    }

    if (sanitized.HupijiaoNotifyUrl !== initial.HupijiaoNotifyUrl) {
      updates.push({
        key: 'HupijiaoNotifyUrl',
        value: sanitized.HupijiaoNotifyUrl,
      })
    }

    if (sanitized.HupijiaoReturnUrl !== initial.HupijiaoReturnUrl) {
      updates.push({
        key: 'HupijiaoReturnUrl',
        value: sanitized.HupijiaoReturnUrl,
      })
    }

    if (sanitized.HupijiaoMinTopUp !== initial.HupijiaoMinTopUp) {
      updates.push({
        key: 'HupijiaoMinTopUp',
        value: sanitized.HupijiaoMinTopUp,
      })
    }

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }

    const nextSecret =
      sanitized.HupijiaoAppSecret || baselineRef.current.HupijiaoAppSecret
    baselineRef.current = {
      ...baselineRef.current,
      ...sanitized,
      HupijiaoAppSecret: nextSecret,
    }
    form.setValue('HupijiaoAppSecret', '')
    toast.success(t('Saved successfully'))
  }

  return (
    <SettingsSection
      title={t('Hupijiao Gateway')}
      description={t(
        'Hupijiao Alipay in CNY; credentials and dedicated top-up pricing (independent from Payment Gateway)'
      )}
    >
      <Form {...form}>
        <form
          className='space-y-8'
          data-no-autosubmit='true'
          onSubmit={(e) => e.preventDefault()}
        >
          <div className='space-y-4'>
            <div>
              <h3 className='text-lg font-medium'>
                {t('Hupijiao top-up pricing')}
              </h3>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Price factor, preset amounts and discounts for Hupijiao only. Does not change Payment Gateway settings.'
                )}
              </p>
            </div>

            <FormField
              control={form.control}
              name='HupijiaoPrice'
              render={({ field }) => (
                <FormItem className='max-w-md'>
                  <FormLabel>
                    {t('Price factor (RMB Alipay top-up)')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      step='0.01'
                      min={0.01}
                      value={(field.value ?? 0) as number}
                      onChange={(event) =>
                        field.onChange(event.target.valueAsNumber)
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Price coefficient (Hupijiao): RMB (yuan) you pay per US$1 of quota. Example: 0.2 means ¥0.2 per $1, i.e. ¥1 buys $5 of quota (1:5). Alipay is charged in RMB. Must be greater than 0.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='grid gap-6 md:grid-cols-2 md:items-start'>
              <FormField
                control={form.control}
                name='HupijiaoAmountOptions'
                render={({ field }) => (
                  <FormItem>
                    <div className='mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                      <FormLabel>{t('Top-up amount options')}</FormLabel>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={() =>
                          setAmountOptionsVisualMode(!amountOptionsVisualMode)
                        }
                        className='w-full sm:w-auto'
                      >
                        {amountOptionsVisualMode ? (
                          <>
                            <Code2 className='mr-2 h-3 w-3' />
                            {t('JSON Editor')}
                          </>
                        ) : (
                          <>
                            <Eye className='mr-2 h-3 w-3' />
                            {t('Visual Editor')}
                          </>
                        )}
                      </Button>
                    </div>
                    <FormControl>
                      {amountOptionsVisualMode ? (
                        <AmountOptionsVisualEditor
                          value={field.value}
                          onChange={field.onChange}
                        />
                      ) : (
                        <Textarea
                          rows={4}
                          placeholder='[10, 20, 50, 100]'
                          {...field}
                          onChange={(event) =>
                            field.onChange(event.target.value)
                          }
                        />
                      )}
                    </FormControl>
                    <FormDescription>
                      {t('Preset recharge amounts (JSON array)')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='HupijiaoAmountDiscount'
                render={({ field }) => (
                  <FormItem>
                    <div className='mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                      <FormLabel>{t('Amount discount')}</FormLabel>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={() =>
                          setAmountDiscountVisualMode(
                            !amountDiscountVisualMode
                          )
                        }
                        className='w-full sm:w-auto'
                      >
                        {amountDiscountVisualMode ? (
                          <>
                            <Code2 className='mr-2 h-3 w-3' />
                            {t('JSON Editor')}
                          </>
                        ) : (
                          <>
                            <Eye className='mr-2 h-3 w-3' />
                            {t('Visual Editor')}
                          </>
                        )}
                      </Button>
                    </div>
                    <FormControl>
                      {amountDiscountVisualMode ? (
                        <AmountDiscountVisualEditor
                          value={field.value}
                          onChange={field.onChange}
                        />
                      ) : (
                        <Textarea
                          rows={4}
                          placeholder='{"100":0.95,"200":0.9}'
                          {...field}
                          onChange={(event) =>
                            field.onChange(event.target.value)
                          }
                        />
                      )}
                    </FormControl>
                    <FormDescription>
                      {t('Discount map by recharge amount (JSON object)')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button
              type='button'
              onClick={(e) => {
                e.preventDefault()
                void saveHupijiaoPricing()
              }}
              disabled={updateOption.isPending}
            >
              {updateOption.isPending
                ? t('Saving...')
                : t('Save Hupijiao top-up pricing')}
            </Button>
          </div>

          <Separator />

          <div className='space-y-6'>
            <div>
              <h3 className='text-lg font-medium'>
                {t('Hupijiao connection')}
              </h3>
              <p className='text-muted-foreground text-sm'>
                {t('APP ID, keys and callback URLs for the Hupijiao channel')}
              </p>
            </div>

            <div className='rounded-md bg-blue-50 p-4 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100'>
              <p className='mb-2 font-medium'>{t('Webhook Configuration:')}</p>
              <ul className='list-inside list-disc space-y-1'>
                <li>
                  {t('Webhook URL:')}{' '}
                  <code className='rounded bg-blue-100 px-1 py-0.5 text-xs dark:bg-blue-900'>
                    {'<ServerAddress>/api/hupijiao/webhook'}
                  </code>
                </li>
                <li>
                  {t(
                    'Leave callback URLs blank to let the backend use the server address when supported.'
                  )}
                </li>
              </ul>
            </div>

            <FormField
              control={form.control}
              name='HupijiaoEnabled'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                  <div className='space-y-0.5'>
                    <FormLabel className='text-base'>
                      {t('Enable Hupijiao')}
                    </FormLabel>
                    <FormDescription>
                      {t('Enable Alipay checkout for wallet and subscriptions')}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className='grid gap-6 md:grid-cols-3'>
              <FormField
                control={form.control}
                name='HupijiaoAppId'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Hupijiao APPID')}</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete='off'
                        {...field}
                        onChange={(event) => field.onChange(event.target.value)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Merchant APPID from Hupijiao dashboard')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='HupijiaoAppSecret'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Hupijiao Secret')}</FormLabel>
                    <FormControl>
                      <Input
                        type='password'
                        placeholder={t('Enter new key to update')}
                        autoComplete='new-password'
                        {...field}
                        onChange={(event) => field.onChange(event.target.value)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Leave blank unless rotating the secret')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='HupijiaoMinTopUp'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Minimum top-up (CNY)')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step='1'
                        value={(field.value ?? 0) as number}
                        onChange={(event) =>
                          field.onChange(event.target.valueAsNumber)
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Minimum actual payment amount in CNY')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name='HupijiaoApiUrl'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Hupijiao API endpoint')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='https://api.xunhupay.com/payment/do.html'
                      {...field}
                      onChange={(event) => field.onChange(event.target.value)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Payment creation endpoint from Hupijiao')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='grid gap-6 md:grid-cols-2'>
              <FormField
                control={form.control}
                name='HupijiaoNotifyUrl'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Notify URL')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='https://yourdomain.com/api/hupijiao/webhook'
                        {...field}
                        onChange={(event) => field.onChange(event.target.value)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Leave blank to use the default webhook URL')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='HupijiaoReturnUrl'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Return URL')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='https://yourdomain.com/wallet'
                        {...field}
                        onChange={(event) => field.onChange(event.target.value)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Where users return after payment')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button
              type='button'
              onClick={(e) => {
                e.preventDefault()
                void saveHupijiaoGateway()
              }}
              disabled={updateOption.isPending}
            >
              {updateOption.isPending
                ? t('Saving...')
                : t('Save Hupijiao settings')}
            </Button>
          </div>
        </form>
      </Form>
    </SettingsSection>
  )
}
