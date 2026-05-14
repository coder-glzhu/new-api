import { useRef, useMemo } from 'react'
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
} from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { useResetForm } from '@/features/system-settings/hooks/use-reset-form'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import type { CustomIntegrationSettings } from './types'

const schema = z.object({
  OpenAIStatusMonitorEnabled: z.boolean(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  defaultValues: CustomIntegrationSettings
}

export function OpenAIStatusMonitorSection({ defaultValues }: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const baselineRef = useRef<CustomIntegrationSettings>(defaultValues)

  const formDefaults = useMemo(
    () => ({
      OpenAIStatusMonitorEnabled: defaultValues.OpenAIStatusMonitorEnabled,
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

  return (
    <SettingsSection
      title={t('OpenAI Status Monitor')}
      description={t(
        'Poll OpenAI status RSS every 5 minutes and push incidents to the configured WeChat groups.'
      )}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
          <FormField
            control={form.control}
            name='OpenAIStatusMonitorEnabled'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>
                    {t('Enable OpenAI status monitor')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      'Requires WeChat notifications to be configured (user ID & group IDs). Only API/ChatGPT/Playground outages are pushed.'
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

          <Button type='submit' disabled={updateOption.isPending}>
            {updateOption.isPending ? t('Saving...') : t('Save')}
          </Button>
        </form>
      </Form>
    </SettingsSection>
  )
}
