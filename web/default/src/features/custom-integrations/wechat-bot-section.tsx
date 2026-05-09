import { useRef, useMemo, useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { useResetForm } from '@/features/system-settings/hooks/use-reset-form'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import { adminSendWechatTest } from './api'
import type { CustomIntegrationSettings } from './types'

const schema = z.object({
  WechatBotEnabled: z.boolean(),
  WechatBotUserId: z.string(),
  WechatBotGroupIds: z.string(),
  WechatBotReminderContent: z.string(),
  WechatBotResultContent: z.string(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  defaultValues: CustomIntegrationSettings
}

export function WechatBotSection({ defaultValues }: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [testLoading, setTestLoading] = useState(false)
  const [testMessage, setTestMessage] = useState('')
  const baselineRef = useRef<CustomIntegrationSettings>(defaultValues)

  const formDefaults = useMemo(
    () => ({
      WechatBotEnabled: defaultValues.WechatBotEnabled,
      WechatBotUserId: defaultValues.WechatBotUserId ?? '',
      WechatBotGroupIds: defaultValues.WechatBotGroupIds ?? '',
      WechatBotReminderContent: defaultValues.WechatBotReminderContent ?? '',
      WechatBotResultContent: defaultValues.WechatBotResultContent ?? '',
    }),
    [defaultValues]
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  const onSubmit = async (values: FormValues) => {
    const keys = Object.keys(values) as Array<keyof FormValues>
    const changed = keys.filter(
      (k) => String(values[k]) !== String(baselineRef.current[k])
    )
    if (changed.length === 0) {
      toast.info(t('No changes to save'))
      return
    }
    for (const key of changed) {
      await updateOption.mutateAsync({ key, value: values[key] })
    }
    baselineRef.current = { ...baselineRef.current, ...values }
  }

  const handleTestSend = async () => {
    setTestLoading(true)
    try {
      await adminSendWechatTest(testMessage || undefined)
      toast.success(t('Test message sent successfully'))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('Failed to send test message') + ': ' + msg)
    } finally {
      setTestLoading(false)
    }
  }

  return (
    <SettingsSection
      title={t('WeChat Group Notifications')}
      description={t(
        'Send lucky bag draw reminders to WeChat groups 1 hour before each draw'
      )}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
          <FormField
            control={form.control}
            name='WechatBotEnabled'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>
                    {t('Enable WeChat notifications')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      'Automatically send lucky bag reminders to configured WeChat groups'
                    )}
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

          <FormField
            control={form.control}
            name='WechatBotUserId'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Bot User ID')}</FormLabel>
                <FormControl>
                  <Input placeholder='NZ0000' {...field} />
                </FormControl>
                <FormDescription>
                  {t('The WeChat bot user ID used to send messages')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='WechatBotGroupIds'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Group IDs')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    placeholder='53505257129@chatroom,54685112607@chatroom'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Comma-separated WeChat group IDs to receive notifications'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='WechatBotReminderContent'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Reminder message content')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    placeholder={t('Leave empty to use default reminder text')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'The message sent to groups 1 hour before each draw. Leave empty to use the built-in default.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='WechatBotResultContent'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Draw result message template')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    placeholder={t('Leave empty to use default result text')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Sent after each draw. Placeholders: {winner} {quota} {code} {date} {hour}'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type='submit' disabled={updateOption.isPending}>
            {updateOption.isPending ? t('Saving...') : t('Save')}
          </Button>

          <div className='space-y-2 rounded-lg border p-4'>
            <p className='text-sm font-medium'>{t('Send test message')}</p>
            <Textarea
              rows={3}
              placeholder={t('Test message content...')}
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
            />
            <Button
              type='button'
              variant='outline'
              onClick={handleTestSend}
              disabled={testLoading}
            >
              {testLoading ? t('Sending...') : t('Send')}
            </Button>
          </div>
        </form>
      </Form>
    </SettingsSection>
  )
}
